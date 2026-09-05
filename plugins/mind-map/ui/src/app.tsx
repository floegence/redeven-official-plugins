import {
  PluginBridgeClient,
  PluginBridgeError,
  type PluginCanvasInputEvent,
  type PluginCanvasPointerEvent,
  type PluginCanvasWheelEvent,
  type PluginMethodResult,
  type PluginSurfaceContext,
  type PluginSurfaceKeyboardEvent,
  type PluginUIActionEvent,
} from '@floegence/redevplugin-ui/plugin';
import {
  edgeAnchor,
  expanderCenter,
  fitLayoutToViewport,
  layoutDocument,
  textLineAnchor,
  topicUnderline,
  type DocumentLayout,
  type LayoutNode,
  type ViewportPadding,
} from './layout.js';
import {
  CONTEXT_MENU_HEIGHT,
  CONTEXT_MENU_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STEP,
  nodeEditorPlacement,
  normalizeSidebarWidth,
  placeContextMenu,
  preserveNodeScreenPosition,
  sidebarWidthClass,
  wheelZoomTarget,
  zoomViewportAtPoint,
} from './editor-ui.js';
import { loadWithRetry } from './startup-load.js';
import {
  EXPORT_FORMATS,
  bitmapExportSize,
  exportLayoutBounds,
  nodeColorValue,
  safeExportBaseName,
  serializeMindMapSVG,
  type ExportFormat,
} from './export.js';
import {
  MAX_IMPORT_BYTES,
  MAX_TITLE_UTF8_BYTES,
  addChild,
  addDocument,
  addSibling,
  createHistory,
  createWorkspace,
  deleteDocument,
  deleteNode,
  duplicateDocument,
  importDocument,
  isValidNodeTextDraft,
  moveNode,
  nodeAndDescendantCount,
  redoHistory,
  renameDocument,
  renameNode,
  parseWorkspaceDSL,
  serializeDocumentDSL,
  serializeWorkspaceDSL,
  selectedDocument,
  setNodeAlignment,
  setNodeColor,
  toggleCollapsed,
  undoHistory,
  validateWorkspace,
  type BranchSide,
  type MindMapDocument,
  type MindMapNode,
  type MindMapWorkspace,
  type NodeAlignment,
  type NodeColor,
  type WorkspaceHistory,
} from './workspace-model.js';

type Locale = 'en' | 'zh';
type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
type Modal =
  | { kind: 'new-document'; title: string }
  | { kind: 'rename-document'; title: string }
  | { kind: 'delete-document'; title: string }
  | { kind: 'delete-node'; title: string; count: number }
  | { kind: 'import'; text: string };
type Viewport = { x: number; y: number; zoom: number };
type DropTarget = { parentID: string; order: number; side?: BranchSide; label: string };
type NodeContextMenu = { nodeID: string; x: number; y: number; hover: number };
type NodeTitleEditor = { nodeID: string; draft: string; isComposing: boolean };
type PointerGesture = {
  pointerID: number;
  kind: 'pan' | 'node';
  nodeID?: string;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  startWorldX?: number;
  startWorldY?: number;
  currentWorldX?: number;
  currentWorldY?: number;
  moved: boolean;
};
type LoadResponse = { revision: number; saved_at: string | null; workspace_dsl: string };
type SaveResponse = { revision: number; saved_at: string };

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const CANVAS_ID = 'map';
const NODE_TITLE_INPUT_KEY = 'node-title-input';
const NODE_COLORS: readonly NodeColor[] = ['accent', 'blue', 'green', 'amber', 'rose', 'violet'];
const NODE_ALIGNMENTS: readonly NodeAlignment[] = ['left', 'center', 'right'];
const DEFAULT_COLORS: PluginSurfaceContext['appearance']['colors'] = {
  canvas: '#f6f7fb', surface: '#ffffff', surface_elevated: '#ffffff', text: '#202532',
  text_muted: '#737b8c', border: '#dfe3eb', accent: '#5865d8', accent_text: '#ffffff',
  success: '#2d9b75', warning: '#c78722', danger: '#cf4c62', focus: '#5865d8',
};

let workspace = createWorkspace(1);
let history: WorkspaceHistory = createHistory(workspace);
let revision = 0;
let savedAt: string | null = null;
let loadState: LoadState = 'loading';
let loadMessage = '';
let saveState: SaveState = 'idle';
let saveMessage = '';
let dirty = false;
let editVersion = 0;
let selectedNodeID = selectedDocument(workspace).nodes[0].id;
let modal: Modal | undefined;
let nodeTitleEditor: NodeTitleEditor | undefined;
let exportMenuOpen = false;
let exportBusy = false;
let exportMessage = '';
let exportRendering = false;
let locale: Locale = 'en';
let colors = DEFAULT_COLORS;
type DrawingCanvas = OffscreenCanvas | HTMLCanvasElement;
type DrawingContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

let canvas: DrawingCanvas | undefined;
let context: DrawingContext | undefined;
let cssWidth = 960;
let cssHeight = 600;
let devicePixelRatio = 1;
let viewport: Viewport = { x: 0, y: 0, zoom: 1 };
let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
let pointer: PointerGesture | undefined;
let dropTarget: DropTarget | undefined;
let nodeContextMenu: NodeContextMenu | undefined;
let visible = true;
let disposed = false;
let surfaceDisposing = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let loadRetryTimer: ReturnType<typeof setTimeout> | undefined;
let viewportRenderTimer: ReturnType<typeof setTimeout> | undefined;
let loadRetryResolve: ((shouldContinue: boolean) => void) | undefined;
let saveInFlight: Promise<boolean> | undefined;
let renderQueue = Promise.resolve();
let lastClick = { nodeID: '', time: 0 };

const COPY = {
  en: {
    app: 'Mind Map', maps: 'Maps', newMap: 'New map', rename: 'Rename', duplicate: 'Duplicate', remove: 'Delete',
    workspace: 'Workspace', documents: 'maps', topics: 'topics', selectedMap: 'Current map',
    undo: 'Undo', redo: 'Redo', bilateral: 'Both sides', right: 'Right only', child: 'Child', sibling: 'Sibling',
    collapse: 'Fold / unfold', importLabel: 'Import file', exportLabel: 'Export file', center: 'Center', loading: 'Restoring your workspace…',
    loadingBody: 'Your saved maps will appear as soon as the local plugin runtime is ready.',
    loadFailedTitle: 'Workspace is still unavailable', loadFailed: 'Your saved data was not changed. Try loading it again.',
    saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', saveFailed: 'Save failed — changes remain here',
    conflict: 'A newer workspace was saved elsewhere.', reload: 'Reload latest', recover: 'Keep mine as copy', retry: 'Retry',
    hint: 'Tab child · Enter sibling · F2 rename · Drag a node to reorganize · Drag empty space to pan',
    newTitle: 'Create a mind map', renameMap: 'Rename mind map', renameNode: 'Rename topic', mapName: 'Map name',
    topic: 'Topic', cancel: 'Cancel', create: 'Create', save: 'Save', confirmDelete: 'Delete', deleteMapTitle: 'Delete this mind map?',
    deleteNodeTitle: 'Delete this branch?', deleteMapBody: 'This cannot be undone after the workspace is saved.',
    deleteNodeBody: 'The selected topic and all topics below it will be removed.', importTitle: 'Import mind map DSL',
    importBody: 'Paste a mind-map 1 document. Legacy mind-map.document.v1 JSON is migrated once.', importAction: 'Import as new map',
    invalidImport: 'The DSL is invalid or exceeds the supported limits.', operationFailed: 'The operation could not be completed.',
    rootCannotDelete: 'The central topic cannot be deleted.', recovered: 'Recovered copy', dropInside: 'Move inside',
    dropBefore: 'Move before', dropAfter: 'Move after', statusReady: 'Ready', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    firstBranch: 'Press Tab to shape your first branch', canvasTools: 'Map editing tools', colors: 'Topic color',
    nodeStyle: 'Topic style', textAlignment: 'Text alignment', alignLeft: 'Align text left',
    alignCenter: 'Center text', alignRight: 'Align text right',
    nodeActions: 'Topic actions', narrowSidebar: 'Narrow map sidebar', widenSidebar: 'Widen map sidebar',
    exportFormat: 'Choose export format', exportPNG: 'PNG image', exportJPEG: 'JPEG image', exportWebP: 'WebP image',
    exportSVG: 'SVG image', exportDSL: 'Mind map DSL', exportFailed: 'The file could not be exported. Try again.',
    dismiss: 'Dismiss', colorAccent: 'Accent', colorBlue: 'Blue', colorGreen: 'Green', colorAmber: 'Amber',
    colorRose: 'Rose', colorViolet: 'Violet',
  },
  zh: {
    app: '思维导图', maps: '导图', newMap: '新建', rename: '重命名', duplicate: '复制', remove: '删除',
    workspace: '工作空间', documents: '张导图', topics: '个节点', selectedMap: '当前导图',
    undo: '撤销', redo: '重做', bilateral: '双向', right: '向右', child: '子节点', sibling: '同级节点',
    collapse: '折叠 / 展开', importLabel: '导入文件', exportLabel: '导出文件', center: '居中', loading: '正在恢复工作区…',
    loadingBody: '本地插件运行时就绪后，将自动载入已保存的导图。',
    loadFailedTitle: '工作区暂时不可用', loadFailed: '已保存的数据没有被修改，请重新载入。',
    saved: '已保存', saving: '正在保存…', unsaved: '有未保存修改', saveFailed: '保存失败，修改仍保留在本地界面',
    conflict: '其他窗口已保存了更新版本。', reload: '载入最新版本', recover: '将我的内容保留为副本', retry: '重试',
    hint: 'Tab 新建子节点 · Enter 新建同级 · F2 重命名 · 拖动节点调整结构 · 拖动空白处平移',
    newTitle: '新建思维导图', renameMap: '重命名导图', renameNode: '重命名节点', mapName: '导图名称',
    topic: '节点标题', cancel: '取消', create: '创建', save: '保存', confirmDelete: '确认删除', deleteMapTitle: '删除这张导图？',
    deleteNodeTitle: '删除整个分支？', deleteMapBody: '工作区保存后，此操作无法撤销。',
    deleteNodeBody: '选中节点及其全部子节点都会被删除。', importTitle: '导入思维导图 DSL',
    importBody: '粘贴 mind-map 1 文档；旧版 mind-map.document.v1 JSON 仅迁移一次。', importAction: '作为新导图导入',
    invalidImport: 'DSL 无效或超过支持范围。', operationFailed: '操作未能完成。', rootCannotDelete: '中心节点不能删除。',
    recovered: '恢复的副本', dropInside: '移入节点', dropBefore: '移到前面', dropAfter: '移到后面',
    statusReady: '可编辑', zoomIn: '放大', zoomOut: '缩小', firstBranch: '按 Tab 创建第一个分支',
    canvasTools: '导图编辑工具', colors: '节点颜色', nodeStyle: '节点样式', textAlignment: '文字对齐',
    alignLeft: '文字左对齐', alignCenter: '文字居中', alignRight: '文字右对齐',
    nodeActions: '节点操作', narrowSidebar: '收窄导图侧边栏', widenSidebar: '加宽导图侧边栏',
    exportFormat: '选择导出格式', exportPNG: 'PNG 图片', exportJPEG: 'JPEG 图片', exportWebP: 'WebP 图片',
    exportSVG: 'SVG 图片', exportDSL: '思维导图 DSL', exportFailed: '文件导出失败，请重试。',
    dismiss: '关闭提示', colorAccent: '主题色', colorBlue: '蓝色', colorGreen: '绿色', colorAmber: '琥珀色',
    colorRose: '玫红色', colorViolet: '紫色',
  },
} as const;

bridge.onAction('new-document', () => openModal({ kind: 'new-document', title: '' }));
bridge.onAction('select-document', (event) => void selectMap(event));
bridge.onAction('rename-document', () => openModal({ kind: 'rename-document', title: currentDocument().title }));
bridge.onAction('duplicate-document', () => runMutation((draft) => duplicateDocument(draft, draft.selected_document_id).nodes[0].id, true));
bridge.onAction('delete-document', () => requestDeleteDocument());
bridge.onAction('undo', () => undo());
bridge.onAction('redo', () => redo());
bridge.onAction('layout-bilateral', () => setLayout('bilateral'));
bridge.onAction('layout-right', () => setLayout('right'));
bridge.onAction('add-child', () => addSelectedChild());
bridge.onAction('add-sibling', () => addSelectedSibling());
bridge.onAction('rename-node', () => requestRenameNode());
bridge.onAction('toggle-collapse', () => toggleSubtree(selectedNodeID));
bridge.onAction('delete-node', () => requestDeleteNode());
bridge.onAction('zoom-in', () => setZoom(viewport.zoom * 1.16));
bridge.onAction('zoom-out', () => setZoom(viewport.zoom / 1.16));
bridge.onAction('center-map', () => centerMap());
bridge.onAction('import-document', () => openModal({ kind: 'import', text: '' }));
bridge.onAction('export-document', () => toggleExportMenu());
bridge.onAction('close-export-menu', () => closeExportMenu());
bridge.onAction('export-file', (event) => void exportCurrentMap(String(event.value ?? '')));
bridge.onAction('dismiss-export-error', () => dismissExportError());
bridge.onAction('set-node-color', (event) => setSelectedColor(String(event.value ?? '')));
bridge.onAction('set-node-alignment', (event) => setSelectedAlignment(String(event.value ?? '')));
bridge.onAction('narrow-sidebar', () => adjustSidebar(-SIDEBAR_WIDTH_STEP));
bridge.onAction('widen-sidebar', () => adjustSidebar(SIDEBAR_WIDTH_STEP));
bridge.onAction('cancel-modal', () => closeModal());
bridge.onAction('submit-modal', (event) => submitModal(event));
bridge.onAction('edit-node-title', (event) => updateNodeTitleEdit(event));
bridge.onAction('commit-node-title', (event) => commitNodeTitleEdit(event));
bridge.onAction('cancel-node-title', (event) => cancelNodeTitleEdit(event));
bridge.onAction('reload-conflict', () => void reloadLatest());
bridge.onAction('recover-conflict', () => void recoverLocalCopy());
bridge.onAction('retry-save', () => void flushSave());
bridge.onAction('retry-workspace-load', () => void retryInitialLoad());
bridge.onCanvasInput(CANVAS_ID, handleCanvasInput);
bridge.onKeyboardInput(handleKeyboardInput);
bridge.onLifecycle(async (event) => {
  if (event.type === 'visible') {
    visible = true;
    draw();
    return;
  }
  if (event.type === 'hidden') {
    visible = false;
    commitNodeTitleEdit();
    pointer = undefined;
    dropTarget = undefined;
    nodeContextMenu = undefined;
    await flushSave();
    return;
  }
  if (event.type === 'dispose') {
    visible = false;
    surfaceDisposing = true;
    commitNodeTitleEdit();
    clearSaveTimer();
    clearLoadRetryWait();
    clearViewportRenderTimer();
    await flushSave();
    disposed = true;
    canvas = undefined;
    context = undefined;
  }
});

void initialize().catch((error) => void showFatal(error));

async function initialize(): Promise<void> {
  await bridge.ready();
  await bridge.setKeyboardBindings([{
    id: 'commit-node-title',
    event: 'keydown',
    code: 'Enter',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    targetKey: NODE_TITLE_INPUT_KEY,
    targetKind: 'editable',
  }]);
  bridge.onContext((next) => {
    colors = next.appearance.colors;
    const nextLocale: Locale = next.locale.language_tag.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const localeChanged = locale !== nextLocale;
    locale = nextLocale;
    draw();
    if (localeChanged && canvas) void updateCanvasAccessibility();
    if (localeChanged) void render();
  });
  await render();
  const surface = await bridge.openCanvas(CANVAS_ID);
  canvas = surface.canvas;
  cssWidth = surface.cssWidth;
  cssHeight = surface.cssHeight;
  devicePixelRatio = surface.devicePixelRatio;
  configureCanvas();
  const drawingContext = canvas.getContext('2d', { alpha: false });
  if (!drawingContext) throw new Error('2D canvas is unavailable');
  context = drawingContext;
  if (!await loadWorkspaceAtStartup()) return;
  await activateLoadedWorkspace();
}

async function activateLoadedWorkspace(): Promise<void> {
  await updateCanvasAccessibility();
  await render();
  draw();
}

function updateCanvasAccessibility(): Promise<void> {
  return bridge.updateCanvasAccessibility(CANVAS_ID, {
    label: text().app,
    description: text().hint,
  });
}

async function showFatal(error: unknown): Promise<void> {
  loadState = 'error';
  loadMessage = error instanceof Error ? error.message : text().loadFailed;
  try {
    await bridge.ready();
    await render();
  } catch {
    // The host owns the unavailable state when bridge startup itself fails.
  }
}

function view() {
  const document = currentDocument();
  const selected = document.nodes.find((node) => node.id === selectedNodeID) ?? document.nodes[0];
  const t = text();
  return (
    <main key="mind-map-root" className={`${loadState === 'ready' ? 'mind-map-app' : 'mind-map-app is-starting'} ${sidebarWidthClass(sidebarWidth)}`}>
      <aside key="document-sidebar" className="document-sidebar" aria-label={t.maps}>
        <header key="sidebar-heading" className="sidebar-heading">
          <span key="brand-mark" className="brand-mark" aria-hidden="true"><span key="brand-core" className="brand-icon lucide-icon icon-network"></span></span>
          <span key="sidebar-title-stack" className="sidebar-title-stack">
            <strong key="sidebar-title">{t.maps}</strong>
            <small key="sidebar-count">{workspace.documents.length} {t.documents}</small>
          </span>
          <button key="new-document" className="icon-button create-map-button has-tooltip tooltip-bottom" type="button" aria-label={t.newMap} data-redevplugin-action="new-document"><span key="new-document-icon" className="tool-icon lucide-icon icon-add"></span></button>
        </header>
        <div key="sidebar-section-label" className="sidebar-section-label"><span key="workspace-label">{t.workspace}</span></div>
        <ul key="document-list" className="document-list">
          {workspace.documents.map((item, index) => (
            <li key={`document-item-${index}`} className={item.id === workspace.selected_document_id ? 'document-card is-active' : 'document-card'}>
              <button key={`document-${index}`} className={item.id === workspace.selected_document_id ? 'document-button is-active' : 'document-button'} type="button" value={item.id} aria-pressed={item.id === workspace.selected_document_id} data-redevplugin-action="select-document">
                <span key={`document-glyph-${index}`} className={`document-glyph color-${item.nodes[0]?.color ?? 'accent'}`} aria-hidden="true"><span key={`document-glyph-core-${index}`} className="document-glyph-icon lucide-icon icon-network"></span></span>
                <span key={`document-copy-${index}`} className="document-copy">
                  <strong key={`document-label-${index}`}>{item.title}</strong>
                  <small key={`document-meta-${index}`}>{item.nodes.length} {t.topics}</small>
                </span>
              </button>
              {item.id === workspace.selected_document_id ? (
                <div key={`document-actions-${index}`} className="document-actions" aria-label={t.selectedMap}>
                  {sideActionButton('rename-document', 'rename', t.rename)}
                  {sideActionButton('duplicate-document', 'duplicate', t.duplicate)}
                  {sideActionButton('delete-document', 'delete', t.remove, workspace.documents.length <= 1)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <footer key="sidebar-footer" className="sidebar-footer">
          <span key="sidebar-shortcut-mark" className="sidebar-shortcut-mark">⌘</span>
          <span key="sidebar-footnote">Tab · Enter · F2</span>
        </footer>
        <div key="sidebar-resizer" className="sidebar-resizer" aria-label={`${t.narrowSidebar} / ${t.widenSidebar}`}>
          <button key="narrow-sidebar" className="sidebar-resize-button has-tooltip tooltip-right" type="button" aria-label={t.narrowSidebar} disabled={sidebarWidth <= MIN_SIDEBAR_WIDTH} data-redevplugin-action="narrow-sidebar"><span key="narrow-sidebar-icon" className="sidebar-resize-icon lucide-icon icon-minus"></span></button>
          <button key="widen-sidebar" className="sidebar-resize-button has-tooltip tooltip-right" type="button" aria-label={t.widenSidebar} disabled={sidebarWidth >= MAX_SIDEBAR_WIDTH} data-redevplugin-action="widen-sidebar"><span key="widen-sidebar-icon" className="sidebar-resize-icon lucide-icon icon-add"></span></button>
        </div>
      </aside>
      <section key="editor-shell" className="editor-shell">
        <div key="canvas-shell" className="canvas-shell">
          <canvas key="map-canvas" className="map-canvas" data-redevplugin-canvas={CANVAS_ID} tabindex={0} autofocus={true} aria-label="Mind Map"></canvas>
          {loadState === 'ready' && nodeTitleEditor ? nodeTitleEditorView() : null}
          {exportMenuOpen ? <button key="export-menu-scrim" className="export-menu-scrim" type="button" tabindex={-1} aria-label={t.dismiss} data-redevplugin-action="close-export-menu"></button> : null}
          <header key="canvas-command-deck" className="canvas-command-deck">
            <div key="canvas-context" className="canvas-context">
              <small key="canvas-eyebrow">{t.selectedMap}</small>
              <strong key="canvas-title">{document.title}</strong>
            </div>
            <nav key="command-bar" className="command-bar" aria-label={t.canvasTools}>
              <div key="history-tools" className="command-cluster history-cluster">
                {toolButton('undo', 'undo', t.undo, history.undo.length === 0)}
                {toolButton('redo', 'redo', t.redo, history.redo.length === 0)}
              </div>
              <div key="structure-tools" className="command-cluster structure-cluster">
                {toolButton('add-child', 'child', t.child)}
                {toolButton('add-sibling', 'sibling', t.sibling)}
                {toolButton('rename-node', 'rename', t.rename)}
                {toolButton('toggle-collapse', 'collapse', t.collapse, !hasChildren(document, selected.id))}
                {toolButton('delete-node', 'delete', t.remove, selected.parent_id === null)}
              </div>
              <div key="view-tools" className="command-cluster view-cluster">
                {toolButton('layout-bilateral', 'bilateral', t.bilateral, false, document.layout === 'bilateral')}
                {toolButton('layout-right', 'right', t.right, false, document.layout === 'right')}
                {toolButton('zoom-out', 'minus', t.zoomOut)}
                <span key="zoom-readout" className="zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
                {toolButton('zoom-in', 'add', t.zoomIn)}
                {toolButton('center-map', 'center', t.center)}
                {toolButton('import-document', 'upload', t.importLabel)}
                <div key="export-control" className="export-control">
                  {toolButton('export-document', 'download', t.exportLabel, exportBusy, exportMenuOpen)}
                  {exportMenuOpen ? exportFormatMenu() : null}
                </div>
              </div>
            </nav>
          </header>
          {loadState === 'ready' ? <span key="save-state" className={saveState === 'error' || saveState === 'conflict' ? 'save-pill is-error' : saveState === 'saving' ? 'save-pill is-saving' : 'save-pill'} role="status"><span key="save-dot" className="save-dot"></span>{saveLabel()}</span> : null}
          <p key="canvas-hint" id="canvas-hint" className="shortcut-pill"><kbd key="tab-key">Tab</kbd><span key="tab-label">{t.child}</span><span key="hint-divider-1">·</span><kbd key="enter-key">Enter</kbd><span key="enter-label">{t.sibling}</span><span key="hint-divider-2">·</span><kbd key="f2-key">F2</kbd><span key="f2-label">{t.rename}</span></p>
          <div key="color-panel" className="color-panel" aria-label={t.nodeStyle}>
            <div key="color-control" className="color-control" role="group" aria-label={t.colors}>
              <span key="color-label" className="color-label">{t.colors}</span>
              {NODE_COLORS.map((color) => (
                <button key={`color-${color}`} className={`color-button color-${color} has-tooltip tooltip-top`} type="button" value={color} aria-label={colorLabel(color)} aria-pressed={selected.color === color} data-redevplugin-action="set-node-color"></button>
              ))}
            </div>
            <span key="style-divider" className="style-divider" aria-hidden="true"></span>
            <div key="alignment-control" className="alignment-control" role="group" aria-label={t.textAlignment}>
              {NODE_ALIGNMENTS.map((alignment) => alignmentButton(alignment, selected.alignment))}
            </div>
          </div>
          {loadState === 'ready' && saveState === 'conflict' ? conflictNotice() : null}
          {loadState === 'ready' && saveState === 'error' ? errorNotice() : null}
          {loadState === 'ready' && exportMessage ? exportErrorNotice() : null}
          {loadState === 'ready' && modal ? modalView(modal) : null}
        </div>
      </section>
      {loadState !== 'ready' ? startupOverlay() : null}
    </main>
  );
}

function toolButton(action: string, icon: string, label: string, disabled = false, pressed?: boolean) {
  return <button key={`tool-${action}`} className="tool-button has-tooltip tooltip-bottom" type="button" aria-label={label} aria-pressed={pressed} disabled={disabled} data-redevplugin-action={action}><span key={`tool-${action}-icon`} className={`tool-icon lucide-icon icon-${icon}`}></span></button>;
}

function sideActionButton(action: string, icon: string, label: string, disabled = false) {
  return <button key={`side-${action}`} className="side-action-button has-tooltip tooltip-top" type="button" aria-label={label} disabled={disabled} data-redevplugin-action={action}><span key={`side-${action}-icon`} className={`tool-icon lucide-icon icon-${icon}`}></span></button>;
}

function alignmentButton(alignment: NodeAlignment, selected: NodeAlignment) {
  const t = text();
  const label = alignment === 'left' ? t.alignLeft : alignment === 'right' ? t.alignRight : t.alignCenter;
  return <button key={`alignment-${alignment}`} className="alignment-button has-tooltip tooltip-top" type="button" aria-label={label} aria-pressed={selected === alignment} value={alignment} data-redevplugin-action="set-node-alignment"><span key={`alignment-${alignment}-icon`} className={`alignment-icon lucide-icon icon-text-${alignment}`}></span></button>;
}

function exportFormatMenu() {
  const t = text();
  return (
    <div key="export-format-menu" className="export-format-menu" role="menu" aria-label={t.exportFormat}>
      {EXPORT_FORMATS.map((format) => (
        <button key={`export-${format}`} className="export-format-button" type="button" role="menuitem" value={format} data-redevplugin-action="export-file">
          <span key={`export-${format}-badge`} className="export-format-badge" aria-hidden="true">{format === 'jpeg' ? 'JPG' : format.toUpperCase()}</span>
          <span key={`export-${format}-label`}>{exportFormatLabel(format)}</span>
        </button>
      ))}
    </div>
  );
}

function startupOverlay() {
  const t = text();
  const failed = loadState === 'error';
  return (
    <div key="startup-overlay" className="startup-overlay" role={failed ? 'alert' : 'status'} aria-live="polite">
      <div key="startup-card" className={failed ? 'startup-card is-error' : 'startup-card'}>
        <div key="startup-eyebrow" className="startup-eyebrow">Mind Map</div>
        {!failed ? <div key="startup-indicator" className="startup-indicator" aria-hidden="true"><span key="startup-indicator-bar"></span></div> : null}
        <strong key="startup-title">{failed ? t.loadFailedTitle : t.loading}</strong>
        {failed ? <p key="startup-message">{loadMessage || t.loadFailed}</p> : null}
        {failed ? <button key="retry-workspace-load" type="button" data-redevplugin-action="retry-workspace-load">{t.retry}</button> : null}
      </div>
    </div>
  );
}

function conflictNotice() {
  const t = text();
  return (
    <div key="conflict-notice" className="notice-banner is-error" role="alert">
      <span key="conflict-message">{t.conflict}</span>
      <button key="reload-conflict" type="button" data-redevplugin-action="reload-conflict">{t.reload}</button>
      <button key="recover-conflict" type="button" data-redevplugin-action="recover-conflict">{t.recover}</button>
    </div>
  );
}

function errorNotice() {
  const t = text();
  return (
    <div key="error-notice" className="notice-banner is-error" role="alert">
      <span key="error-message">{saveMessage || t.saveFailed}</span>
      <button key="retry-save" type="button" data-redevplugin-action="retry-save">{t.retry}</button>
    </div>
  );
}

function exportErrorNotice() {
  const t = text();
  return (
    <div key="export-error-notice" className="notice-banner is-error" role="alert">
      <span key="export-error-message">{exportMessage}</span>
      <button key="dismiss-export-error" type="button" data-redevplugin-action="dismiss-export-error">{t.dismiss}</button>
    </div>
  );
}

function nodeTitleEditorView() {
  const editor = nodeTitleEditor;
  if (!editor) return null;
  const document = currentDocument();
  const node = document.nodes.find((candidate) => candidate.id === editor.nodeID);
  const box = currentLayout().nodes.get(editor.nodeID);
  if (!node || !box) return null;
  const placement = nodeEditorPlacement(box, viewport, cssWidth, cssHeight);
  return (
    <form key={`node-title-editor-${node.id}`} className={`${placement.className} color-${node.color} alignment-${node.alignment}`} autocomplete="off" data-redevplugin-action="commit-node-title">
      <textarea
        key={NODE_TITLE_INPUT_KEY}
        name="value"
        value={editor.draft}
        placeholder={node.title}
        maxlength={MAX_TITLE_UTF8_BYTES}
        autofocus={true}
        aria-label={text().topic}
        data-redevplugin-action="edit-node-title"
        data-redevplugin-escape-action="cancel-node-title"
      ></textarea>
    </form>
  );
}

function modalView(current: Modal) {
  const t = text();
  const details = modalDetails(current);
  const isText = current.kind === 'import';
  const isDelete = current.kind === 'delete-document' || current.kind === 'delete-node';
  return (
    <div key="modal-backdrop" className="modal-backdrop" role="presentation">
      <form key="modal-card" className="modal-card" data-redevplugin-action="submit-modal">
        <h2 key="modal-title">{details.title}</h2>
        {details.body ? <p key="modal-body">{details.body}</p> : null}
        {isText
          ? <textarea key="modal-value" name="value" maxlength={MAX_IMPORT_BYTES} autofocus={true} aria-label={details.label}>{current.text}</textarea>
          : isDelete
            ? null
            : <input key="modal-value" type="text" name="value" value={current.title} maxlength={80} autocomplete="off" autofocus={true} aria-label={details.label}></input>}
        <div key="modal-actions" className="modal-actions">
          <button key="cancel-modal" className="tool-button" type="button" data-redevplugin-action="cancel-modal">{t.cancel}</button>
          <button key="submit-modal" className={isDelete ? 'danger-button' : 'primary-button'} type="submit">{details.action}</button>
        </div>
      </form>
    </div>
  );
}

function modalDetails(current: Modal): { title: string; body: string; label: string; action: string } {
  const t = text();
  switch (current.kind) {
    case 'new-document': return { title: t.newTitle, body: '', label: t.mapName, action: t.create };
    case 'rename-document': return { title: t.renameMap, body: '', label: t.mapName, action: t.save };
    case 'delete-document': return { title: t.deleteMapTitle, body: t.deleteMapBody, label: '', action: t.confirmDelete };
    case 'delete-node': return { title: t.deleteNodeTitle, body: `${t.deleteNodeBody} (${current.count})`, label: '', action: t.confirmDelete };
    case 'import': return { title: t.importTitle, body: t.importBody, label: t.importTitle, action: t.importAction };
  }
}

function submitModal(event: PluginUIActionEvent): void {
  if (!modal) return;
  const value = String(event.form_data?.value ?? '').trim();
  try {
    if (modal.kind === 'new-document') {
      runMutation((draft) => addDocument(draft, value || undefined).nodes[0].id, true);
    } else if (modal.kind === 'rename-document') {
      runMutation((draft) => renameDocument(selectedDocument(draft), value) ? selectedNodeID : undefined);
    } else if (modal.kind === 'delete-document') {
      runMutation((draft) => {
        deleteDocument(draft, draft.selected_document_id);
        return selectedDocument(draft).nodes[0].id;
      }, true);
    } else if (modal.kind === 'delete-node') {
      const node = currentDocument().nodes.find((candidate) => candidate.id === selectedNodeID);
      const parentID = node?.parent_id;
      runMutation((draft) => {
        if (!parentID || !deleteNode(selectedDocument(draft), selectedNodeID)) return undefined;
        return parentID;
      });
    } else if (modal.kind === 'import') {
      runMutation((draft) => importDocument(value, draft).nodes[0].id, true);
    }
    modal = undefined;
  } catch {
    saveMessage = text().invalidImport;
    saveState = 'error';
  }
  void render();
  draw();
}

function openModal(next: Modal): void {
  if (loadState !== 'ready') return;
  commitNodeTitleEdit();
  exportMenuOpen = false;
  modal = next;
  void render();
}

function closeModal(): void {
  modal = undefined;
  void render();
  draw();
}

function toggleExportMenu(): void {
  if (loadState !== 'ready' || exportBusy) return;
  commitNodeTitleEdit();
  modal = undefined;
  nodeContextMenu = undefined;
  exportMenuOpen = !exportMenuOpen;
  void render();
  draw();
}

function closeExportMenu(): void {
  if (!exportMenuOpen) return;
  exportMenuOpen = false;
  void render();
}

function dismissExportError(): void {
  exportMessage = '';
  void render();
}

async function exportCurrentMap(value: string): Promise<void> {
  if (loadState !== 'ready' || exportBusy || !EXPORT_FORMATS.includes(value as ExportFormat)) return;
  const format = value as ExportFormat;
  exportMenuOpen = false;
  exportBusy = true;
  exportMessage = '';
  commitNodeTitleEdit();
  void render();

  try {
    const document = currentDocument();
    const layout = layoutDocument(document, undefined, measureCanvasText);
    const baseName = safeExportBaseName(document.title);
    if (format === 'dsl') {
      await bridge.exportFile({
        fileName: `${baseName}.mindmap`,
        mediaType: 'text/plain',
        bytes: new TextEncoder().encode(serializeDocumentDSL(document)),
      });
    } else if (format === 'svg') {
      await bridge.exportFile({
        fileName: `${baseName}.svg`,
        mediaType: 'image/svg+xml',
        bytes: new TextEncoder().encode(serializeMindMapSVG(document, layout, colors)),
      });
    } else {
      const mediaType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      const blob = await renderBitmapExport(layout, mediaType);
      await bridge.exportFile({
        fileName: `${baseName}.${format === 'jpeg' ? 'jpg' : format}`,
        mediaType,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    }
  } catch {
    exportMessage = text().exportFailed;
  } finally {
    exportBusy = false;
    await render();
    draw();
  }
}

async function renderBitmapExport(
  layout: DocumentLayout,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp',
): Promise<Blob> {
  const bounds = exportLayoutBounds(layout);
  const size = bitmapExportSize(bounds);
  // DOM canvases have a reliable toBlob implementation in Electron's plugin iframe.
  // The transferred surface remains an OffscreenCanvas; only the temporary export
  // target uses the DOM-backed path so image export works across renderer versions.
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = size.width;
  targetCanvas.height = size.height;
  const targetContext = targetCanvas.getContext('2d', { alpha: false });
  if (!targetContext) throw new Error('2D export canvas is unavailable');

  const previous = {
    canvas,
    context,
    cssWidth,
    cssHeight,
    devicePixelRatio,
    viewport,
    selectedNodeID,
    nodeTitleEditor,
    pointer,
    dropTarget,
    nodeContextMenu,
    exportRendering,
  };
  try {
    canvas = targetCanvas;
    context = targetContext;
    cssWidth = size.width;
    cssHeight = size.height;
    devicePixelRatio = 1;
    viewport = {
      x: -bounds.left * size.scale - size.width / 2,
      y: -bounds.top * size.scale - size.height / 2,
      zoom: size.scale,
    };
    selectedNodeID = '';
    nodeTitleEditor = undefined;
    pointer = undefined;
    dropTarget = undefined;
    nodeContextMenu = undefined;
    exportRendering = true;
    draw();
  } finally {
    canvas = previous.canvas;
    context = previous.context;
    cssWidth = previous.cssWidth;
    cssHeight = previous.cssHeight;
    devicePixelRatio = previous.devicePixelRatio;
    viewport = previous.viewport;
    selectedNodeID = previous.selectedNodeID;
    nodeTitleEditor = previous.nodeTitleEditor;
    pointer = previous.pointer;
    dropTarget = previous.dropTarget;
    nodeContextMenu = previous.nodeContextMenu;
    exportRendering = previous.exportRendering;
  }
  return new Promise<Blob>((resolve, reject) => {
    targetCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Bitmap export produced no data'));
    }, mediaType, mediaType === 'image/png' ? undefined : 0.92);
  });
}

async function selectMap(event: PluginUIActionEvent): Promise<void> {
  if (loadState !== 'ready') return;
  const id = String(event.value ?? '');
  if (!workspace.documents.some((document) => document.id === id) || id === workspace.selected_document_id) return;
  commitNodeTitleEdit();
  await flushSave();
  workspace = clone(workspace);
  workspace.selected_document_id = id;
  history.present = clone(workspace);
  selectedNodeID = selectedDocument(workspace).nodes[0].id;
  centerMap(false);
  markDirty(true);
  await render();
  draw();
  await flushSave();
}

function requestDeleteDocument(): void {
  if (workspace.documents.length <= 1) return;
  openModal({ kind: 'delete-document', title: currentDocument().title });
}

function requestDeleteNode(): void {
  const node = currentDocument().nodes.find((candidate) => candidate.id === selectedNodeID);
  if (!node || node.parent_id === null) {
    saveMessage = text().rootCannotDelete;
    saveState = 'error';
    void render();
    return;
  }
  const count = nodeAndDescendantCount(currentDocument(), selectedNodeID);
  if (count > 1) openModal({ kind: 'delete-node', title: node.title, count });
  else runMutation((draft) => {
    const selected = selectedDocument(draft).nodes.find((candidate) => candidate.id === selectedNodeID);
    const parentID = selected?.parent_id;
    if (!parentID || !deleteNode(selectedDocument(draft), selectedNodeID)) return undefined;
    return parentID;
  });
}

function requestRenameNode(): void {
  beginNodeTitleEdit(selectedNodeID);
}

function addSelectedChild(): void {
  let createdID = '';
  runMutation((draft) => {
    createdID = addChild(selectedDocument(draft), selectedNodeID).id;
    return createdID;
  });
  if (createdID) beginNodeTitleEdit(createdID, true);
}

function addSelectedSibling(): void {
  let createdID = '';
  runMutation((draft) => {
    createdID = addSibling(selectedDocument(draft), selectedNodeID).id;
    return createdID;
  });
  if (createdID) beginNodeTitleEdit(createdID, true);
}

function beginNodeTitleEdit(nodeID: string, clear = false): void {
  if (loadState !== 'ready' || modal) return;
  const node = currentDocument().nodes.find((candidate) => candidate.id === nodeID);
  if (!node) return;
  selectedNodeID = node.id;
  pointer = undefined;
  dropTarget = undefined;
  nodeContextMenu = undefined;
  const before = currentLayout().nodes.get(node.id);
  nodeTitleEditor = { nodeID: node.id, draft: clear ? '' : node.title, isComposing: false };
  const after = currentLayout().nodes.get(node.id);
  if (before && after) viewport = preserveNodeScreenPosition(viewport, before, after);
  revealSelection();
  void render();
  draw();
}

function updateNodeTitleEdit(event: PluginUIActionEvent): void {
  if (!nodeTitleEditor || (event.event !== 'input' && event.event !== 'change')) return;
  const before = currentLayout().nodes.get(nodeTitleEditor.nodeID);
  const next = String(event.value ?? '').replace(new RegExp('\\r\\n?', 'gu'), '\n');
  nodeTitleEditor.isComposing = event.isComposing;
  if (!isValidNodeTextDraft(next)) {
    void render();
    return;
  }
  nodeTitleEditor.draft = next;
  const after = currentLayout().nodes.get(nodeTitleEditor.nodeID);
  if (before && after) viewport = preserveNodeScreenPosition(viewport, before, after);
  revealSelection();
  void render();
  draw();
  if (event.event === 'change' && !event.isComposing) commitNodeTitleEdit();
}

function commitNodeTitleEdit(event?: PluginUIActionEvent): void {
  const editor = nodeTitleEditor;
  if (!editor || event?.isComposing || editor.isComposing) return;
  if (event?.form_data) {
    const next = String(event.form_data.value ?? editor.draft).replace(new RegExp('\\r\\n?', 'gu'), '\n');
    if (isValidNodeTextDraft(next)) editor.draft = next;
  }
  nodeTitleEditor = undefined;
  const before = workspace;
  runMutation((draft) => renameNode(selectedDocument(draft), editor.nodeID, editor.draft) ? editor.nodeID : undefined);
  if (workspace === before) {
    void render();
    draw();
  }
}

function cancelNodeTitleEdit(event?: PluginUIActionEvent): void {
  if (!nodeTitleEditor || event?.isComposing || nodeTitleEditor.isComposing) return;
  const nodeID = nodeTitleEditor.nodeID;
  const before = currentLayout().nodes.get(nodeID);
  nodeTitleEditor = undefined;
  const after = currentLayout().nodes.get(nodeID);
  if (before && after) viewport = preserveNodeScreenPosition(viewport, before, after);
  void render();
  draw();
}

function toggleSubtree(nodeID: string): void {
  if (nodeTitleEditor?.isComposing) return;
  commitNodeTitleEdit();
  runMutation(
    (draft) => toggleCollapsed(selectedDocument(draft), nodeID) ? nodeID : undefined,
    false,
    nodeID,
  );
}

function setLayout(layout: MindMapDocument['layout']): void {
  runMutation((draft) => {
    const document = selectedDocument(draft);
    if (document.layout === layout) return undefined;
    document.layout = layout;
    document.updated_at = new Date().toISOString();
    return selectedNodeID;
  });
  centerMap(false);
}

function setSelectedColor(value: string): void {
  if (!NODE_COLORS.includes(value as NodeColor)) return;
  runMutation((draft) => setNodeColor(selectedDocument(draft), selectedNodeID, value as NodeColor) ? selectedNodeID : undefined);
}

function setSelectedAlignment(value: string): void {
  if (!NODE_ALIGNMENTS.includes(value as NodeAlignment)) return;
  runMutation((draft) => setNodeAlignment(selectedDocument(draft), selectedNodeID, value) ? selectedNodeID : undefined);
}

function adjustSidebar(delta: number): void {
  const next = normalizeSidebarWidth(sidebarWidth + delta);
  if (next === sidebarWidth) return;
  sidebarWidth = next;
  nodeContextMenu = undefined;
  void render();
}

function runMutation(
  mutator: (draft: MindMapWorkspace) => string | undefined,
  immediateSave = false,
  anchorNodeID?: string,
): void {
  if (loadState !== 'ready') return;
  nodeContextMenu = undefined;
  try {
    const anchorBefore = anchorNodeID ? currentLayout().nodes.get(anchorNodeID) : undefined;
    const draft = clone(workspace);
    const nextSelected = mutator(draft);
    validateWorkspace(draft);
    if (JSON.stringify(draft) === JSON.stringify(workspace)) return;
    workspace = draft;
    history.commit(workspace);
    ensureSelection(nextSelected);
    const anchorAfter = anchorNodeID ? currentLayout().nodes.get(anchorNodeID) : undefined;
    if (anchorBefore && anchorAfter) viewport = preserveNodeScreenPosition(viewport, anchorBefore, anchorAfter);
    revealSelection();
    markDirty(immediateSave);
    saveMessage = '';
    void render();
    draw();
  } catch (error) {
    saveMessage = error instanceof Error ? error.message : text().operationFailed;
    saveState = 'error';
    void render();
  }
}

function undo(): void {
  if (loadState !== 'ready') return;
  nodeContextMenu = undefined;
  const next = undoHistory(history, workspace);
  if (next === workspace) return;
  workspace = next;
  ensureSelection();
  markDirty(false);
  void render();
  draw();
}

function redo(): void {
  if (loadState !== 'ready') return;
  nodeContextMenu = undefined;
  const next = redoHistory(history, workspace);
  if (next === workspace) return;
  workspace = next;
  ensureSelection();
  markDirty(false);
  void render();
  draw();
}

function ensureSelection(preferred?: string): void {
  const document = currentDocument();
  selectedNodeID = document.nodes.some((node) => node.id === preferred)
    ? preferred!
    : document.nodes.some((node) => node.id === selectedNodeID) ? selectedNodeID : document.nodes[0].id;
}

function markDirty(immediate: boolean): void {
  if (loadState !== 'ready') return;
  dirty = true;
  editVersion += 1;
  if (saveState !== 'conflict') saveState = 'dirty';
  clearSaveTimer();
  if (immediate) void flushSave();
  else saveTimer = setTimeout(() => { saveTimer = undefined; void flushSave(); }, 400);
}

async function flushSave(): Promise<void> {
  clearSaveTimer();
  if (loadState !== 'ready') return;
  if (saveInFlight) await saveInFlight;
  while (!disposed && dirty && saveState !== 'conflict') {
    const saved = await saveOnce();
    if (!saved) break;
  }
}

async function saveOnce(): Promise<boolean> {
  if (saveInFlight) return saveInFlight;
  const snapshot = clone(workspace);
  const snapshotVersion = editVersion;
  const expectedRevision = revision;
  saveState = 'saving';
  void render();
  saveInFlight = (async () => {
    try {
      const response = await bridge.call<PluginMethodResult<SaveResponse>>('mindmap.workspace.save', {
        expected_revision: expectedRevision,
        workspace_dsl: serializeWorkspaceDSL(snapshot),
      });
      revision = response.data.revision;
      savedAt = response.data.saved_at;
      if (editVersion === snapshotVersion) dirty = false;
      saveState = dirty ? 'dirty' : 'saved';
      saveMessage = '';
      return true;
    } catch (error) {
      if (error instanceof PluginBridgeError && error.errorCode === 'MIND_MAP_CONFLICT') {
        saveState = 'conflict';
        saveMessage = text().conflict;
      } else {
        saveState = 'error';
        saveMessage = text().saveFailed;
      }
      dirty = true;
      return false;
    } finally {
      saveInFlight = undefined;
      void render();
    }
  })();
  return saveInFlight;
}

async function loadWorkspaceAtStartup(): Promise<boolean> {
  clearLoadRetryWait();
  loadState = 'loading';
  loadMessage = '';
  saveState = 'idle';
  await render();
  let response: PluginMethodResult<LoadResponse>;
  try {
    response = await loadWithRetry(
      () => bridge.call<PluginMethodResult<LoadResponse>>('mindmap.workspace.load', {}),
      waitForLoadRetry,
    );
  } catch {
    if (surfaceDisposing || disposed) return false;
    loadState = 'error';
    loadMessage = text().loadFailed;
    await render();
    draw();
    return false;
  }
  try {
    parseWorkspaceDSL(response.data.workspace_dsl);
  } catch {
    loadState = 'error';
    loadMessage = text().loadFailed;
    await render();
    draw();
    return false;
  }
  applyLoadedWorkspace(response.data);
  loadState = 'ready';
  saveState = savedAt ? 'saved' : 'idle';
  await render();
  draw();
  return true;
}

async function retryInitialLoad(): Promise<void> {
  if (loadState === 'loading' || surfaceDisposing || disposed) return;
  if (await loadWorkspaceAtStartup()) await activateLoadedWorkspace();
}

function applyLoadedWorkspace(response: LoadResponse): void {
  workspace = parseWorkspaceDSL(response.workspace_dsl);
  revision = response.revision;
  savedAt = response.saved_at;
  history = createHistory(workspace);
  selectedNodeID = selectedDocument(workspace).nodes[0].id;
  dirty = false;
  saveMessage = '';
  modal = undefined;
  nodeTitleEditor = undefined;
  centerMap(false);
}

async function reloadLatest(): Promise<void> {
  if (loadState !== 'ready') return;
  try {
    const response = await bridge.call<PluginMethodResult<LoadResponse>>('mindmap.workspace.load', {});
    parseWorkspaceDSL(response.data.workspace_dsl);
    applyLoadedWorkspace(response.data);
    saveState = 'saved';
  } catch (error) {
    saveState = 'error';
    saveMessage = error instanceof Error ? error.message : text().operationFailed;
  }
  await render();
  draw();
}

async function recoverLocalCopy(): Promise<void> {
  if (loadState !== 'ready') return;
  const localDocument = clone(currentDocument());
  try {
    const response = await bridge.call<PluginMethodResult<LoadResponse>>('mindmap.workspace.load', {});
    const remote = parseWorkspaceDSL(response.data.workspace_dsl);
    const recovered = importDocument(serializeDocumentDSL(localDocument), remote, Date.now());
    renameDocument(recovered, `${localDocument.title} — ${text().recovered}`);
    workspace = remote;
    revision = response.data.revision;
    savedAt = response.data.saved_at;
    history = createHistory(workspace);
    selectedNodeID = recovered.nodes[0].id;
    saveState = 'dirty';
    saveMessage = '';
    dirty = true;
    editVersion += 1;
    await render();
    draw();
    await flushSave();
  } catch (error) {
    saveState = 'error';
    saveMessage = error instanceof Error ? error.message : text().operationFailed;
    await render();
  }
}

function handleCanvasInput(event: PluginCanvasInputEvent): void {
  if (event.type === 'resize') {
    cssWidth = event.cssWidth;
    cssHeight = event.cssHeight;
    devicePixelRatio = event.devicePixelRatio;
    configureCanvas();
    revealSelection();
    draw();
    if (nodeTitleEditor) void render();
    return;
  }
  if (loadState !== 'ready' || modal) return;
  if (event.type === 'blur') {
    pointer = undefined;
    dropTarget = undefined;
    draw();
    return;
  }
  if (event.type === 'pointer') handlePointer(event);
  if (event.type === 'wheel') handleWheel(event);
}

function handleWheel(event: PluginCanvasWheelEvent): void {
  const nextZoom = wheelZoomTarget(viewport.zoom, event.deltaY, event.deltaMode, cssHeight);
  if (nextZoom === viewport.zoom) return;
  nodeContextMenu = undefined;
  setZoom(nextZoom, event.x, event.y, false);
}

function handleKeyboardInput(event: PluginSurfaceKeyboardEvent): void {
  if (loadState !== 'ready' || modal || event.event !== 'keydown' || event.repeat || event.isComposing) return;
  if (nodeTitleEditor) {
    if (event.bindingId === 'commit-node-title') commitNodeTitleEdit();
    return;
  }
  if (event.targetKind !== 'canvas') return;
  handleKey(event);
}

function handleKey(event: PluginSurfaceKeyboardEvent): void {
  if (event.code === 'Escape' && nodeContextMenu) {
    nodeContextMenu = undefined;
    draw();
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  if (command && event.code === 'KeyZ') {
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if (command && (event.code === 'Equal' || event.key === '+')) { setZoom(viewport.zoom * 1.16); return; }
  if (command && (event.code === 'Minus' || event.key === '-')) { setZoom(viewport.zoom / 1.16); return; }
  if (command && event.code === 'Digit0') { centerMap(); return; }
  if (event.altKey || command) return;
  if (event.code === 'Tab') addSelectedChild();
  else if (event.code === 'Enter') addSelectedSibling();
  else if (event.code === 'F2') requestRenameNode();
  else if (event.code === 'Delete' || event.code === 'Backspace') requestDeleteNode();
  else if (event.code.startsWith('Arrow')) selectDirectional(event.code);
}

function handlePointer(event: PluginCanvasPointerEvent): void {
  const world = screenToWorld(event.x, event.y);
  if (event.event === 'pointerdown') {
    if (nodeTitleEditor?.isComposing) return;
    commitNodeTitleEdit();
    if (event.button === 2) {
      pointer = undefined;
      dropTarget = undefined;
      const hit = hitNode(world.x, world.y);
      if (!hit) {
        nodeContextMenu = undefined;
      } else {
        selectedNodeID = hit.id;
        nodeContextMenu = { nodeID: hit.id, ...placeContextMenu(event.x, event.y, cssWidth, cssHeight), hover: -1 };
        void render();
      }
      draw();
      return;
    }
    if (event.button !== 0) return;
    if (nodeContextMenu) {
      if (activateNodeContextMenu(event.x, event.y)) return;
      nodeContextMenu = undefined;
    }
    const expander = hitExpander(world.x, world.y);
    if (expander) {
      pointer = undefined;
      dropTarget = undefined;
      selectedNodeID = expander.id;
      lastClick = { nodeID: '', time: 0 };
      toggleSubtree(expander.id);
      return;
    }
    const hit = hitNode(world.x, world.y);
    if (hit) {
      selectedNodeID = hit.id;
      pointer = {
        pointerID: event.pointerId, kind: 'node', nodeID: hit.id, startX: event.x, startY: event.y,
        startPanX: viewport.x, startPanY: viewport.y, moved: false,
        startWorldX: world.x, startWorldY: world.y, currentWorldX: world.x, currentWorldY: world.y,
      };
      void render();
      draw();
    } else {
      pointer = {
        pointerID: event.pointerId, kind: 'pan', startX: event.x, startY: event.y,
        startPanX: viewport.x, startPanY: viewport.y, moved: false,
      };
    }
    return;
  }
  if (event.event === 'pointermove' && nodeContextMenu && !pointer) {
    const nextHover = nodeContextMenuHit(event.x, event.y);
    if (nextHover !== nodeContextMenu.hover) {
      nodeContextMenu.hover = nextHover;
      draw();
    }
    return;
  }
  if (!pointer || pointer.pointerID !== event.pointerId) return;
  if (event.event === 'pointermove') {
    const distance = Math.hypot(event.x - pointer.startX, event.y - pointer.startY);
    if (distance > 5) pointer.moved = true;
    if (pointer.kind === 'node') {
      pointer.currentWorldX = world.x;
      pointer.currentWorldY = world.y;
    }
    if (pointer.kind === 'pan') {
      viewport.x = pointer.startPanX + event.x - pointer.startX;
      viewport.y = pointer.startPanY + event.y - pointer.startY;
    } else if (pointer.moved && pointer.nodeID && !isRoot(pointer.nodeID)) {
      dropTarget = findDropTarget(pointer.nodeID, world.x, world.y);
    }
    draw();
    return;
  }
  if (event.event === 'pointerup') {
    const finished = pointer;
    pointer = undefined;
    if (finished.kind === 'node' && finished.nodeID) {
      if (finished.moved && dropTarget && !isRoot(finished.nodeID)) {
        const target = dropTarget;
        runMutation((draft) => moveNode(selectedDocument(draft), finished.nodeID!, target.parentID, target.side, target.order) ? finished.nodeID : undefined);
      } else if (!finished.moved) {
        const now = performance.now();
        if (lastClick.nodeID === finished.nodeID && now - lastClick.time < 360) requestRenameNode();
        lastClick = { nodeID: finished.nodeID, time: now };
      }
    }
    dropTarget = undefined;
    draw();
    return;
  }
  if (event.event === 'pointercancel') {
    pointer = undefined;
    dropTarget = undefined;
    draw();
  }
}

function nodeContextMenuItems(nodeID = nodeContextMenu?.nodeID ?? selectedNodeID): Array<{ label: string; shortcut: string; disabled: boolean; danger?: boolean }> {
  const document = currentDocument();
  const node = document.nodes.find((candidate) => candidate.id === nodeID) ?? document.nodes[0];
  const root = node.parent_id === null;
  const t = text();
  return [
    { label: t.child, shortcut: 'Tab', disabled: false },
    { label: t.sibling, shortcut: 'Enter', disabled: root },
    { label: t.rename, shortcut: 'F2', disabled: false },
    { label: t.collapse, shortcut: '', disabled: !hasChildren(document, node.id) },
    { label: t.remove, shortcut: '⌫', disabled: root, danger: true },
  ];
}

function nodeContextMenuHit(x: number, y: number): number {
  if (!nodeContextMenu) return -1;
  const localX = x - nodeContextMenu.x;
  const localY = y - nodeContextMenu.y;
  if (localX < 0 || localY < 0 || localX > CONTEXT_MENU_WIDTH || localY > CONTEXT_MENU_HEIGHT) return -1;
  if (localY >= 36 && localY < 206) return Math.floor((localY - 36) / 34);
  if (localY >= 238 && localY <= 270) {
    for (let index = 0; index < NODE_COLORS.length; index += 1) {
      const centerX = 26 + index * 28;
      if (Math.hypot(localX - centerX, localY - 254) <= 13) return 100 + index;
    }
  }
  return 99;
}

function activateNodeContextMenu(x: number, y: number): boolean {
  const hit = nodeContextMenuHit(x, y);
  if (hit < 0) return false;
  selectedNodeID = nodeContextMenu?.nodeID ?? selectedNodeID;
  if (hit >= 100) {
    const color = NODE_COLORS[hit - 100];
    nodeContextMenu = undefined;
    if (color) setSelectedColor(color);
    return true;
  }
  const item = nodeContextMenuItems()[hit];
  if (!item || item.disabled) return true;
  nodeContextMenu = undefined;
  if (hit === 0) addSelectedChild();
  else if (hit === 1) addSelectedSibling();
  else if (hit === 2) requestRenameNode();
  else if (hit === 3) toggleSubtree(selectedNodeID);
  else if (hit === 4) requestDeleteNode();
  return true;
}

function drawNodeContextMenu(): void {
  if (!context || !nodeContextMenu) return;
  const document = currentDocument();
  const node = document.nodes.find((candidate) => candidate.id === nodeContextMenu!.nodeID);
  if (!node) return;
  const menu = nodeContextMenu;
  const items = nodeContextMenuItems();
  context.save();
  context.shadowColor = withAlpha('#000000', 0.3);
  context.shadowBlur = 34;
  context.shadowOffsetY = 14;
  roundedRect(context, menu.x, menu.y, CONTEXT_MENU_WIDTH, CONTEXT_MENU_HEIGHT, 16);
  context.fillStyle = withAlpha(colors.surface_elevated, 0.98);
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = 1;
  context.strokeStyle = withAlpha(colors.border, 0.9);
  context.stroke();

  context.font = '700 11px system-ui, sans-serif';
  context.fillStyle = colors.text_muted;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(node.title.split('\n')[0], menu.x + 14, menu.y + 18, CONTEXT_MENU_WIDTH - 28);

  context.beginPath();
  context.moveTo(menu.x + 10, menu.y + 35.5);
  context.lineTo(menu.x + CONTEXT_MENU_WIDTH - 10, menu.y + 35.5);
  context.strokeStyle = withAlpha(colors.border, 0.62);
  context.stroke();

  items.forEach((item, index) => {
    const rowY = menu.y + 36 + index * 34;
    if (menu.hover === index && !item.disabled) {
      roundedRect(context!, menu.x + 6, rowY + 3, CONTEXT_MENU_WIDTH - 12, 28, 8);
      context!.fillStyle = item.danger ? withAlpha(colors.danger, 0.11) : withAlpha(colors.accent, 0.11);
      context!.fill();
    }
    context!.globalAlpha = item.disabled ? 0.32 : 1;
    context!.font = '620 12px system-ui, sans-serif';
    context!.fillStyle = item.danger ? colors.danger : colors.text;
    context!.textAlign = 'left';
    context!.fillText(item.label, menu.x + 14, rowY + 17);
    if (item.shortcut) {
      context!.font = '600 9px ui-monospace, monospace';
      context!.fillStyle = colors.text_muted;
      context!.textAlign = 'right';
      context!.fillText(item.shortcut, menu.x + CONTEXT_MENU_WIDTH - 14, rowY + 17);
    }
    context!.globalAlpha = 1;
  });

  context.beginPath();
  context.moveTo(menu.x + 10, menu.y + 211.5);
  context.lineTo(menu.x + CONTEXT_MENU_WIDTH - 10, menu.y + 211.5);
  context.strokeStyle = withAlpha(colors.border, 0.62);
  context.stroke();
  context.font = '650 9px system-ui, sans-serif';
  context.fillStyle = colors.text_muted;
  context.textAlign = 'left';
  context.fillText(text().colors, menu.x + 14, menu.y + 226);
  NODE_COLORS.forEach((color, index) => {
    const centerX = menu.x + 26 + index * 28;
    const centerY = menu.y + 254;
    if (menu.hover === 100 + index) {
      context!.beginPath();
      context!.arc(centerX, centerY, 11, 0, Math.PI * 2);
      context!.fillStyle = withAlpha(nodeColor(color), 0.2);
      context!.fill();
    }
    context!.beginPath();
    context!.arc(centerX, centerY, 7, 0, Math.PI * 2);
    context!.fillStyle = nodeColor(color);
    context!.fill();
    if (node.color === color) {
      context!.beginPath();
      context!.arc(centerX, centerY, 10, 0, Math.PI * 2);
      context!.lineWidth = 1.5;
      context!.strokeStyle = colors.focus;
      context!.stroke();
    }
  });
  context.restore();
}

function findDropTarget(draggedID: string, x: number, y: number): DropTarget | undefined {
  const document = currentDocument();
  const targetBox = hitNode(x, y, draggedID);
  if (!targetBox) return undefined;
  const target = document.nodes.find((node) => node.id === targetBox.id);
  if (!target || target.id === draggedID || isWithinBranch(document, target.id, draggedID)) return undefined;
  const t = text();
  if (target.parent_id !== null && Math.abs(y - targetBox.y) > targetBox.height * 0.27) {
    const siblings = document.nodes.filter((node) => node.parent_id === target.parent_id && node.id !== draggedID).sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((node) => node.id === target.id);
    const after = y > targetBox.y;
    return { parentID: target.parent_id, order: Math.max(0, index + (after ? 1 : 0)), side: target.side, label: after ? t.dropAfter : t.dropBefore };
  }
  const childCount = document.nodes.filter((node) => node.parent_id === target.id && node.id !== draggedID).length;
  const side = target.parent_id === null ? (x < targetBox.x ? 'left' : 'right') : target.side;
  return { parentID: target.id, order: childCount, side, label: t.dropInside };
}

function selectDirectional(code: string): void {
  const layout = currentLayout();
  const current = layout.nodes.get(selectedNodeID);
  if (!current) return;
  const direction = code === 'ArrowLeft' ? { x: -1, y: 0 } : code === 'ArrowRight' ? { x: 1, y: 0 } : code === 'ArrowUp' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  let best: { id: string; score: number } | undefined;
  for (const node of layout.nodes.values()) {
    if (node.id === current.id) continue;
    const dx = node.x - current.x;
    const dy = node.y - current.y;
    const forward = dx * direction.x + dy * direction.y;
    if (forward <= 4) continue;
    const sideways = Math.abs(dx * direction.y - dy * direction.x);
    const score = forward + sideways * 2.4;
    if (!best || score < best.score) best = { id: node.id, score };
  }
  if (best) {
    selectedNodeID = best.id;
    void render();
    draw();
  }
}

function configureCanvas(): void {
  if (!canvas) return;
  canvas.width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * devicePixelRatio));
}

function draw(): void {
  if (!context || !canvas || !visible) return;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  drawCanvasAtmosphere();
  if (!exportRendering) drawGrid();
  if (loadState !== 'ready') return;
  context.save();
  context.translate(cssWidth / 2 + viewport.x, cssHeight / 2 + viewport.y);
  context.scale(viewport.zoom, viewport.zoom);
  const layout = currentLayout();
  drawEdges(layout);
  drawNodes(layout);
  if (!exportRendering && currentDocument().nodes.length === 1) drawFirstBranchHint(layout);
  context.restore();
  if (!exportRendering && nodeContextMenu) drawNodeContextMenu();
}

function drawCanvasAtmosphere(): void {
  if (!context) return;
  const background = context.createLinearGradient(0, 0, cssWidth, cssHeight);
  background.addColorStop(0, mixColor(colors.canvas, colors.surface, 0.16));
  background.addColorStop(0.54, colors.canvas);
  background.addColorStop(1, mixColor(colors.canvas, colors.accent, 0.035));
  context.fillStyle = background;
  context.fillRect(0, 0, cssWidth, cssHeight);

  const glowRadius = Math.max(cssWidth, cssHeight) * 0.62;
  const glow = context.createRadialGradient(cssWidth * 0.54, cssHeight * 0.42, 0, cssWidth * 0.54, cssHeight * 0.42, glowRadius);
  glow.addColorStop(0, withAlpha(colors.accent, 0.045));
  glow.addColorStop(1, withAlpha(colors.accent, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, cssWidth, cssHeight);
}

function drawGrid(): void {
  if (!context) return;
  const gap = Math.max(22, 32 * viewport.zoom);
  const offsetX = ((cssWidth / 2 + viewport.x) % gap + gap) % gap;
  const offsetY = ((cssHeight / 2 + viewport.y) % gap + gap) % gap;
  context.fillStyle = withAlpha(colors.text_muted, 0.11);
  context.beginPath();
  for (let x = offsetX; x < cssWidth; x += gap) {
    for (let y = offsetY; y < cssHeight; y += gap) {
      context.moveTo(x + 0.75, y);
      context.arc(x, y, 0.75, 0, Math.PI * 2);
    }
  }
  context.fill();
}

function drawEdges(layout: DocumentLayout): void {
  if (!context) return;
  const document = currentDocument();
  context.lineCap = 'round';
  for (const edge of layout.edges) {
    const from = layout.nodes.get(edge.from);
    const to = layout.nodes.get(edge.to);
    const fromNode = document.nodes.find((node) => node.id === edge.from);
    const toNode = document.nodes.find((node) => node.id === edge.to);
    if (!from || !to || !fromNode || !toNode) continue;
    const start = edgeAnchor(from, edge.side, 'source');
    const end = edgeAnchor(to, edge.side, 'target');
    const bend = Math.abs(end.x - start.x) * 0.48;
    const fromColor = nodeColor(fromNode.color);
    const toColor = nodeColor(toNode.color);
    const stroke = context.createLinearGradient(start.x, start.y, end.x, end.y);
    stroke.addColorStop(0, withAlpha(fromColor, from.depth === 0 ? 0.34 : 0.58));
    stroke.addColorStop(1, withAlpha(toColor, to.depth <= 1 ? 0.88 : 0.72));
    context.lineWidth = (to.depth === 1 ? 2.6 : to.depth === 2 ? 1.8 : 1.45) / viewport.zoom;
    context.strokeStyle = stroke;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.bezierCurveTo(
      start.x + (edge.side === 'right' ? bend : -bend),
      start.y,
      end.x - (edge.side === 'right' ? bend : -bend),
      end.y,
      end.x,
      end.y,
    );
    context.stroke();
  }
}

function drawNodes(layout: DocumentLayout): void {
  if (!context) return;
  const document = currentDocument();
  const draggingID = activeDraggedNodeID();
  for (const box of layout.nodes.values()) {
    const node = document.nodes.find((candidate) => candidate.id === box.id);
    if (!node) continue;
    const isDragging = node.id === draggingID;
    drawNodeAt(box, node, node.id === selectedNodeID && !isDragging, dropTarget?.parentID === node.id, isDragging ? 0.2 : 1);
  }
  if (draggingID) drawDraggedNode(layout, document, draggingID);
  if (dropTarget && pointer?.kind === 'node') drawDropLabel(layout);
}

function drawNodeAt(box: LayoutNode, node: MindMapNode, selected: boolean, isDropParent: boolean, opacity = 1): void {
  if (!context) return;
  context.save();
  context.globalAlpha = opacity;
  if (selected) drawSelectionHalo(box);
  const accent = nodeColor(node.color);
  if (box.depth >= 2) drawTopicNode(box, accent, selected, isDropParent);
  else drawBlockNode(box, node, accent, selected, isDropParent);

  if (nodeTitleEditor?.nodeID !== node.id) {
    context.fillStyle = box.depth === 0
      ? contrastText(accent)
      : box.depth === 1
        ? colors.text
        : mixColor(colors.text, accent, 0.22);
    context.font = box.text.font;
    const textAnchor = textLineAnchor(box, node.alignment);
    context.textAlign = textAnchor.textAlign;
    context.textBaseline = 'middle';
    const firstLineY = box.y + (box.depth >= 2 ? -2 : 0) - ((box.text.lines.length - 1) * box.text.lineHeight) / 2;
    for (const [lineIndex, line] of box.text.lines.entries()) {
      context.fillText(line, textAnchor.x, firstLineY + lineIndex * box.text.lineHeight);
    }
  }
  if (!exportRendering && hasChildren(currentDocument(), node.id)) {
    const badge = expanderCenter(box);
    context.beginPath();
    context.arc(badge.x, badge.y, 7.5, 0, Math.PI * 2);
    context.fillStyle = colors.surface;
    context.fill();
    context.lineWidth = 1.25 / viewport.zoom;
    context.strokeStyle = withAlpha(accent, 0.68);
    context.stroke();
    context.fillStyle = accent;
    context.font = '700 10px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(node.collapsed ? '+' : '−', badge.x, badge.y + 0.5);
  }
  context.restore();
}

function activeDraggedNodeID(): string | undefined {
  if (!pointer || pointer.kind !== 'node' || !pointer.moved || !pointer.nodeID || isRoot(pointer.nodeID)) return undefined;
  return pointer.nodeID;
}

function drawDraggedNode(layout: DocumentLayout, document: MindMapDocument, nodeID: string): void {
  if (!pointer || pointer.startWorldX === undefined || pointer.startWorldY === undefined ||
      pointer.currentWorldX === undefined || pointer.currentWorldY === undefined) return;
  const box = layout.nodes.get(nodeID);
  const node = document.nodes.find((candidate) => candidate.id === nodeID);
  if (!box || !node) return;
  const preview: LayoutNode = {
    ...box,
    x: box.x + pointer.currentWorldX - pointer.startWorldX,
    y: box.y + pointer.currentWorldY - pointer.startWorldY,
  };
  drawNodeAt(preview, node, true, false, 0.92);
}

function drawBlockNode(box: LayoutNode, node: MindMapNode, accent: string, selected: boolean, isDropParent: boolean): void {
  if (!context) return;
  context.shadowColor = selected ? withAlpha(colors.focus, 0.18) : withAlpha('#000000', box.depth === 0 ? 0.18 : 0.1);
  context.shadowBlur = box.depth === 0 ? 24 : selected ? 16 : 10;
  context.shadowOffsetY = box.depth === 0 ? 8 : 4;
  roundedRect(context, box.x - box.width / 2, box.y - box.height / 2, box.width, box.height, box.depth === 0 ? 14 : 11);
  if (box.depth === 0) {
    const rootFill = context.createLinearGradient(box.x - box.width / 2, box.y - box.height / 2, box.x + box.width / 2, box.y + box.height / 2);
    rootFill.addColorStop(0, mixColor(nodeColor(node.color), '#ffffff', 0.14));
    rootFill.addColorStop(1, mixColor(nodeColor(node.color), '#000000', 0.1));
    context.fillStyle = rootFill;
  } else {
    context.fillStyle = mixColor(colors.surface_elevated, accent, 0.13);
  }
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = (isDropParent ? 2.5 : 1) / viewport.zoom;
  context.strokeStyle = isDropParent
    ? colors.success
    : box.depth === 0
      ? withAlpha('#ffffff', 0.22)
      : withAlpha(accent, selected ? 0.62 : 0.26);
  context.stroke();

  if (box.depth === 1) {
    const railWidth = 3;
    const railX = box.side === 'left' ? box.x + box.width / 2 - railWidth - 2 : box.x - box.width / 2 + 2;
    const railHeight = Math.min(24, box.height - 14);
    roundedRect(context, railX, box.y - railHeight / 2, railWidth, railHeight, 2);
    context.fillStyle = accent;
    context.fill();
  }
}

function drawTopicNode(box: LayoutNode, accent: string, selected: boolean, isDropParent: boolean): void {
  if (!context) return;
  const underline = topicUnderline(box);
  if (isDropParent) {
    context.save();
    context.setLineDash([4 / viewport.zoom, 3 / viewport.zoom]);
    roundedRect(context, box.x - box.width / 2, box.y - box.height / 2, box.width, box.height, 7);
    context.lineWidth = 1.5 / viewport.zoom;
    context.strokeStyle = withAlpha(colors.success, 0.82);
    context.stroke();
    context.restore();
  }
  context.save();
  context.shadowColor = selected ? withAlpha(accent, 0.34) : 'transparent';
  context.shadowBlur = selected ? 8 : 0;
  context.lineWidth = (isDropParent ? 2.8 : selected ? 2.4 : box.depth === 2 ? 2 : 1.6) / viewport.zoom;
  context.strokeStyle = isDropParent ? colors.success : withAlpha(accent, selected ? 0.96 : 0.78);
  context.beginPath();
  context.moveTo(underline.startX, underline.y);
  context.lineTo(underline.endX, underline.y);
  context.stroke();
  context.restore();
}

function drawSelectionHalo(box: LayoutNode): void {
  if (!context) return;
  context.save();
  context.shadowColor = withAlpha(colors.focus, box.depth >= 2 ? 0.18 : 0.32);
  context.shadowBlur = box.depth >= 2 ? 8 : 16;
  roundedRect(context, box.x - box.width / 2 - 4, box.y - box.height / 2 - 4, box.width + 8, box.height + 8, box.depth === 0 ? 17 : box.depth === 1 ? 14 : 11);
  context.lineWidth = (box.depth >= 2 ? 1.25 : 1.5) / viewport.zoom;
  if (box.depth >= 2) context.setLineDash([4 / viewport.zoom, 3 / viewport.zoom]);
  context.strokeStyle = withAlpha(colors.focus, box.depth >= 2 ? 0.62 : 0.48);
  context.stroke();
  context.restore();
}

function drawFirstBranchHint(layout: DocumentLayout): void {
  if (!context) return;
  const root = [...layout.nodes.values()].find((node) => node.depth === 0);
  if (!root) return;
  const label = text().firstBranch;
  context.save();
  context.font = '600 11px system-ui, sans-serif';
  const width = context.measureText(label).width + 24;
  roundedRect(context, root.x - width / 2, root.y + root.height / 2 + 18, width, 28, 14);
  context.fillStyle = withAlpha(colors.surface_elevated, 0.82);
  context.fill();
  context.fillStyle = colors.text_muted;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, root.x, root.y + root.height / 2 + 32);
  context.restore();
}

function drawDropLabel(layout: DocumentLayout): void {
  if (!context || !dropTarget) return;
  const parent = layout.nodes.get(dropTarget.parentID);
  if (!parent) return;
  context.save();
  context.font = '700 11px system-ui, sans-serif';
  const width = context.measureText(dropTarget.label).width + 18;
  roundedRect(context, parent.x - width / 2, parent.y + parent.height / 2 + 10, width, 24, 8);
  context.fillStyle = colors.success;
  context.fill();
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(dropTarget.label, parent.x, parent.y + parent.height / 2 + 22);
  context.restore();
}

function hitNode(x: number, y: number, excludedID?: string): LayoutNode | undefined {
  const nodes = [...currentLayout().nodes.values()].reverse();
  return nodes.find((box) => box.id !== excludedID && x >= box.x - box.width / 2 && x <= box.x + box.width / 2 && y >= box.y - box.height / 2 && y <= box.y + box.height / 2);
}

function hitExpander(x: number, y: number): LayoutNode | undefined {
  const document = currentDocument();
  const radius = 18 / viewport.zoom;
  const nodes = [...currentLayout().nodes.values()].reverse();
  return nodes.find((box) => {
    if (!hasChildren(document, box.id)) return false;
    const center = expanderCenter(box);
    return Math.hypot(x - center.x, y - center.y) <= radius;
  });
}

function screenToWorld(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - cssWidth / 2 - viewport.x) / viewport.zoom,
    y: (y - cssHeight / 2 - viewport.y) / viewport.zoom,
  };
}

function centerMap(renderUI = true): void {
  viewport = fitLayoutToViewport(currentLayout(), cssWidth, cssHeight, viewportPadding());
  draw();
  if (renderUI) void render();
}

function revealSelection(): void {
  let box = currentLayout().nodes.get(selectedNodeID);
  if (!box) return;
  const padding = viewportPadding();
  const availableWidth = Math.max(1, cssWidth - padding.left - padding.right);
  const availableHeight = Math.max(1, cssHeight - padding.top - padding.bottom);
  const fittingZoom = Math.min(viewport.zoom, availableWidth / box.width, availableHeight / box.height);
  if (fittingZoom < viewport.zoom) {
    const anchorX = cssWidth / 2 + viewport.x + box.x * viewport.zoom;
    const anchorY = cssHeight / 2 + viewport.y + box.y * viewport.zoom;
    viewport = zoomViewportAtPoint(viewport, fittingZoom, anchorX, anchorY, cssWidth, cssHeight);
    box = currentLayout().nodes.get(selectedNodeID) ?? box;
  }
  const left = cssWidth / 2 + viewport.x + (box.x - box.width / 2) * viewport.zoom;
  const right = cssWidth / 2 + viewport.x + (box.x + box.width / 2) * viewport.zoom;
  const top = cssHeight / 2 + viewport.y + (box.y - box.height / 2) * viewport.zoom;
  const bottom = cssHeight / 2 + viewport.y + (box.y + box.height / 2) * viewport.zoom;
  if (left < padding.left) viewport.x += padding.left - left;
  else if (right > cssWidth - padding.right) viewport.x -= right - (cssWidth - padding.right);
  if (top < padding.top) viewport.y += padding.top - top;
  else if (bottom > cssHeight - padding.bottom) viewport.y -= bottom - (cssHeight - padding.bottom);
}

function currentLayout(): DocumentLayout {
  const editing = nodeTitleEditor ? { nodeID: nodeTitleEditor.nodeID, title: nodeTitleEditor.draft } : undefined;
  return layoutDocument(currentDocument(), editing, measureCanvasText);
}

function measureCanvasText(value: string, font: string): number {
  if (!context) return [...value].length * 8;
  context.save();
  context.font = font;
  const width = context.measureText(value).width;
  context.restore();
  return width;
}

function viewportPadding(): ViewportPadding {
  return { top: cssWidth < 520 ? 108 : 76, right: 28, bottom: 68, left: 28 };
}

function setZoom(value: number, anchorX = cssWidth / 2, anchorY = cssHeight / 2, renderImmediately = true): void {
  if (loadState !== 'ready') return;
  viewport = zoomViewportAtPoint(viewport, value, anchorX, anchorY, cssWidth, cssHeight);
  if (nodeTitleEditor) revealSelection();
  draw();
  if (renderImmediately) {
    clearViewportRenderTimer();
    void render();
  } else {
    scheduleViewportRender();
  }
}

function currentDocument(): MindMapDocument {
  return selectedDocument(workspace);
}

function isRoot(nodeID: string): boolean {
  return currentDocument().nodes.find((node) => node.id === nodeID)?.parent_id === null;
}

function isWithinBranch(document: MindMapDocument, nodeID: string, ancestorID: string): boolean {
  let cursor = document.nodes.find((node) => node.id === nodeID);
  while (cursor && cursor.parent_id !== null) {
    if (cursor.parent_id === ancestorID) return true;
    const parentID = cursor.parent_id;
    cursor = document.nodes.find((node) => node.id === parentID);
  }
  return false;
}

function hasChildren(document: MindMapDocument, nodeID: string): boolean {
  return document.nodes.some((node) => node.parent_id === nodeID);
}

function saveLabel(): string {
  const t = text();
  if (saveState === 'saving') return t.saving;
  if (saveState === 'dirty') return t.unsaved;
  if (saveState === 'error') return t.saveFailed;
  if (saveState === 'conflict') return t.conflict;
  if (saveState === 'saved' && savedAt) return t.saved;
  return t.statusReady;
}

function render(): Promise<void> {
  renderQueue = renderQueue.catch(() => undefined).then(() => disposed ? undefined : bridge.render(view()));
  return renderQueue;
}

function clearSaveTimer(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = undefined;
}

function scheduleViewportRender(): void {
  if (viewportRenderTimer !== undefined) return;
  viewportRenderTimer = setTimeout(() => {
    viewportRenderTimer = undefined;
    if (!disposed) void render();
  }, 48);
}

function clearViewportRenderTimer(): void {
  if (viewportRenderTimer !== undefined) clearTimeout(viewportRenderTimer);
  viewportRenderTimer = undefined;
}

function waitForLoadRetry(delayMs: number): Promise<boolean> {
  if (surfaceDisposing || disposed) return Promise.resolve(false);
  return new Promise((resolve) => {
    loadRetryResolve = resolve;
    loadRetryTimer = setTimeout(() => {
      loadRetryTimer = undefined;
      loadRetryResolve = undefined;
      resolve(true);
    }, delayMs);
  });
}

function clearLoadRetryWait(): void {
  if (loadRetryTimer !== undefined) clearTimeout(loadRetryTimer);
  loadRetryTimer = undefined;
  const resolve = loadRetryResolve;
  loadRetryResolve = undefined;
  resolve?.(false);
}

function text() {
  return COPY[locale];
}

function exportFormatLabel(format: ExportFormat): string {
  const t = text();
  if (format === 'png') return t.exportPNG;
  if (format === 'jpeg') return t.exportJPEG;
  if (format === 'webp') return t.exportWebP;
  if (format === 'svg') return t.exportSVG;
  return t.exportDSL;
}

function colorLabel(color: NodeColor): string {
  const t = text();
  if (color === 'accent') return t.colorAccent;
  if (color === 'blue') return t.colorBlue;
  if (color === 'green') return t.colorGreen;
  if (color === 'amber') return t.colorAmber;
  if (color === 'rose') return t.colorRose;
  return t.colorViolet;
}

function nodeColor(color: NodeColor): string {
  return nodeColorValue(color, colors);
}

function mixColor(left: string, right: string, rightAmount: number): string {
  const leftValue = parseHexColor(left);
  const rightValue = parseHexColor(right);
  if (leftValue === undefined || rightValue === undefined) return left;
  const amount = Math.max(0, Math.min(1, rightAmount));
  const channel = (shift: number) => Math.round(((leftValue >> shift) & 255) * (1 - amount) + ((rightValue >> shift) & 255) * amount);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function contrastText(hex: string): string {
  const value = parseHexColor(hex);
  if (value === undefined) return colors.accent_text;
  const luminance = ((value >> 16) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000;
  return luminance > 170 ? '#202532' : '#ffffff';
}

function roundedRect(target: DrawingContext, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  target.beginPath();
  target.moveTo(x + r, y);
  target.lineTo(x + width - r, y);
  target.quadraticCurveTo(x + width, y, x + width, y + r);
  target.lineTo(x + width, y + height - r);
  target.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  target.lineTo(x + r, y + height);
  target.quadraticCurveTo(x, y + height, x, y + height - r);
  target.lineTo(x, y + r);
  target.quadraticCurveTo(x, y, x + r, y);
  target.closePath();
}

function withAlpha(hex: string, alpha: number): string {
  const value = parseHexColor(hex);
  if (value === undefined) return hex;
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function parseHexColor(value: string): number | undefined {
  if (value.length !== 7 || value[0] !== '#') return undefined;
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const upper = code >= 65 && code <= 70;
    const lower = code >= 97 && code <= 102;
    if (!digit && !upper && !lower) return undefined;
  }
  return Number.parseInt(value.slice(1), 16);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
