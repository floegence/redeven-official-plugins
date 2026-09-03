import {
  PluginBridgeClient,
  PluginBridgeError,
  type PluginCanvasInputEvent,
  type PluginCanvasPointerEvent,
  type PluginMethodResult,
  type PluginSurfaceContext,
  type PluginUIActionEvent,
} from '@floegence/redevplugin-ui/plugin';
import { fitLayoutToViewport, layoutDocument, type DocumentLayout, type LayoutNode, type ViewportPadding } from './layout.js';
import {
  CONTEXT_MENU_HEIGHT,
  CONTEXT_MENU_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STEP,
  normalizeSidebarWidth,
  placeContextMenu,
  sidebarWidthClass,
} from './editor-ui.js';
import { loadWithRetry } from './startup-load.js';
import {
  MAX_IMPORT_BYTES,
  addChild,
  addDocument,
  addSibling,
  createHistory,
  createWorkspace,
  deleteDocument,
  deleteNode,
  duplicateDocument,
  exportDocument,
  importDocument,
  moveNode,
  nodeAndDescendantCount,
  redoHistory,
  renameDocument,
  renameNode,
  selectedDocument,
  setNodeColor,
  toggleCollapsed,
  undoHistory,
  validateWorkspace,
  type BranchSide,
  type MindMapDocument,
  type MindMapNode,
  type MindMapWorkspace,
  type NodeColor,
  type WorkspaceHistory,
} from './workspace-model.js';

type Locale = 'en' | 'zh';
type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
type Modal =
  | { kind: 'new-document'; title: string }
  | { kind: 'rename-document'; title: string }
  | { kind: 'rename-node'; title: string }
  | { kind: 'delete-document'; title: string }
  | { kind: 'delete-node'; title: string; count: number }
  | { kind: 'import'; text: string }
  | { kind: 'export'; text: string };
type Viewport = { x: number; y: number; zoom: number };
type DropTarget = { parentID: string; order: number; side?: BranchSide; label: string };
type NodeContextMenu = { nodeID: string; x: number; y: number; hover: number };
type PointerGesture = {
  pointerID: number;
  kind: 'pan' | 'node';
  nodeID?: string;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  moved: boolean;
};
type LoadResponse = { revision: number; saved_at: string | null; workspace: MindMapWorkspace };
type SaveResponse = { revision: number; saved_at: string };

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const CANVAS_ID = 'map';
const NODE_COLORS: readonly NodeColor[] = ['accent', 'blue', 'green', 'amber', 'rose', 'violet'];
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
let locale: Locale = 'en';
let colors = DEFAULT_COLORS;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | undefined;
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
let loadRetryResolve: ((shouldContinue: boolean) => void) | undefined;
let saveInFlight: Promise<boolean> | undefined;
let renderQueue = Promise.resolve();
let lastClick = { nodeID: '', time: 0 };

const COPY = {
  en: {
    app: 'Mind Map', maps: 'Maps', newMap: 'New map', rename: 'Rename', duplicate: 'Duplicate', remove: 'Delete',
    workspace: 'Workspace', documents: 'maps', topics: 'topics', selectedMap: 'Current map',
    undo: 'Undo', redo: 'Redo', bilateral: 'Both sides', right: 'Right only', child: 'Child', sibling: 'Sibling',
    collapse: 'Fold / unfold', importLabel: 'Import', exportLabel: 'Export', center: 'Center', loading: 'Restoring your workspace…',
    loadingBody: 'Your saved maps will appear as soon as the local plugin runtime is ready.',
    loadFailedTitle: 'Workspace is still unavailable', loadFailed: 'Your saved data was not changed. Try loading it again.',
    saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', saveFailed: 'Save failed — changes remain here',
    conflict: 'A newer workspace was saved elsewhere.', reload: 'Reload latest', recover: 'Keep mine as copy', retry: 'Retry',
    hint: 'Tab child · Enter sibling · F2 rename · Drag a node to reorganize · Drag empty space to pan',
    newTitle: 'Create a mind map', renameMap: 'Rename mind map', renameNode: 'Rename topic', mapName: 'Map name',
    topic: 'Topic', cancel: 'Cancel', create: 'Create', save: 'Save', confirmDelete: 'Delete', deleteMapTitle: 'Delete this mind map?',
    deleteNodeTitle: 'Delete this branch?', deleteMapBody: 'This cannot be undone after the workspace is saved.',
    deleteNodeBody: 'The selected topic and all topics below it will be removed.', importTitle: 'Import mind map JSON',
    importBody: 'Paste a mind-map.document.v1 file. Imported IDs are regenerated.', importAction: 'Import as new map',
    exportTitle: 'Export current mind map', exportBody: 'Copy this JSON and keep it as a portable backup.', close: 'Close',
    invalidImport: 'The JSON file is invalid or exceeds the supported limits.', operationFailed: 'The operation could not be completed.',
    rootCannotDelete: 'The central topic cannot be deleted.', recovered: 'Recovered copy', dropInside: 'Move inside',
    dropBefore: 'Move before', dropAfter: 'Move after', statusReady: 'Ready', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    firstBranch: 'Press Tab to shape your first branch', canvasTools: 'Map editing tools', colors: 'Topic color',
    nodeActions: 'Topic actions', resizeSidebar: 'Resize map sidebar',
  },
  zh: {
    app: '思维导图', maps: '导图', newMap: '新建', rename: '重命名', duplicate: '复制', remove: '删除',
    workspace: '工作空间', documents: '张导图', topics: '个节点', selectedMap: '当前导图',
    undo: '撤销', redo: '重做', bilateral: '双向', right: '向右', child: '子节点', sibling: '同级节点',
    collapse: '折叠 / 展开', importLabel: '导入', exportLabel: '导出', center: '居中', loading: '正在恢复工作区…',
    loadingBody: '本地插件运行时就绪后，将自动载入已保存的导图。',
    loadFailedTitle: '工作区暂时不可用', loadFailed: '已保存的数据没有被修改，请重新载入。',
    saved: '已保存', saving: '正在保存…', unsaved: '有未保存修改', saveFailed: '保存失败，修改仍保留在本地界面',
    conflict: '其他窗口已保存了更新版本。', reload: '载入最新版本', recover: '将我的内容保留为副本', retry: '重试',
    hint: 'Tab 新建子节点 · Enter 新建同级 · F2 重命名 · 拖动节点调整结构 · 拖动空白处平移',
    newTitle: '新建思维导图', renameMap: '重命名导图', renameNode: '重命名节点', mapName: '导图名称',
    topic: '节点标题', cancel: '取消', create: '创建', save: '保存', confirmDelete: '确认删除', deleteMapTitle: '删除这张导图？',
    deleteNodeTitle: '删除整个分支？', deleteMapBody: '工作区保存后，此操作无法撤销。',
    deleteNodeBody: '选中节点及其全部子节点都会被删除。', importTitle: '导入思维导图 JSON',
    importBody: '粘贴 mind-map.document.v1 文件。导入后会重新生成全部 ID。', importAction: '作为新导图导入',
    exportTitle: '导出当前导图', exportBody: '复制以下 JSON，可作为可移植备份。', close: '关闭',
    invalidImport: 'JSON 无效或超过支持范围。', operationFailed: '操作未能完成。', rootCannotDelete: '中心节点不能删除。',
    recovered: '恢复的副本', dropInside: '移入节点', dropBefore: '移到前面', dropAfter: '移到后面',
    statusReady: '可编辑', zoomIn: '放大', zoomOut: '缩小', firstBranch: '按 Tab 创建第一个分支',
    canvasTools: '导图编辑工具', colors: '节点颜色',
    nodeActions: '节点操作', resizeSidebar: '调整导图侧边栏宽度',
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
bridge.onAction('toggle-collapse', () => runMutation((draft) => toggleCollapsed(selectedDocument(draft), selectedNodeID) ? selectedNodeID : undefined));
bridge.onAction('delete-node', () => requestDeleteNode());
bridge.onAction('zoom-in', () => setZoom(viewport.zoom * 1.16));
bridge.onAction('zoom-out', () => setZoom(viewport.zoom / 1.16));
bridge.onAction('center-map', () => centerMap());
bridge.onAction('import-document', () => openModal({ kind: 'import', text: '' }));
bridge.onAction('export-document', () => openModal({ kind: 'export', text: exportDocument(currentDocument()) }));
bridge.onAction('set-node-color', (event) => setSelectedColor(String(event.value ?? '')));
bridge.onAction('resize-sidebar', (event) => resizeSidebar(String(event.value ?? '')));
bridge.onAction('cancel-modal', () => closeModal());
bridge.onAction('submit-modal', (event) => submitModal(event));
bridge.onAction('reload-conflict', () => void reloadLatest());
bridge.onAction('recover-conflict', () => void recoverLocalCopy());
bridge.onAction('retry-save', () => void flushSave());
bridge.onAction('retry-workspace-load', () => void retryInitialLoad());
bridge.onCanvasInput(CANVAS_ID, handleCanvasInput);
bridge.onLifecycle(async (event) => {
  if (event.type === 'visible') {
    visible = true;
    draw();
    return;
  }
  if (event.type === 'hidden') {
    visible = false;
    pointer = undefined;
    dropTarget = undefined;
    nodeContextMenu = undefined;
    await flushSave();
    return;
  }
  if (event.type === 'dispose') {
    visible = false;
    surfaceDisposing = true;
    clearSaveTimer();
    clearLoadRetryWait();
    await flushSave();
    disposed = true;
    canvas = undefined;
    context = undefined;
  }
});

void initialize().catch((error) => void showFatal(error));

async function initialize(): Promise<void> {
  await bridge.ready();
  bridge.onContext((next) => {
    colors = next.appearance.colors;
    const nextLocale: Locale = next.locale.language_tag.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const localeChanged = locale !== nextLocale;
    locale = nextLocale;
    draw();
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
  await bridge.updateCanvasAccessibility(CANVAS_ID, {
    label: text().app,
    description: text().hint,
  });
  await render();
  draw();
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
          <button key="new-document" className="icon-button create-map-button" type="button" title={t.newMap} aria-label={t.newMap} data-redevplugin-action="new-document"><span key="new-document-icon" className="tool-icon lucide-icon icon-add"></span></button>
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
        <span key="sidebar-resizer-handle" className="sidebar-resizer-handle" aria-hidden="true"></span>
        <input key="sidebar-resizer" className="sidebar-resizer" type="range" name="sidebar-width" min={MIN_SIDEBAR_WIDTH} max={MAX_SIDEBAR_WIDTH} step={SIDEBAR_WIDTH_STEP} value={sidebarWidth} aria-label={t.resizeSidebar} title={t.resizeSidebar} data-redevplugin-action="resize-sidebar"></input>
      </aside>
      <section key="editor-shell" className="editor-shell">
        <div key="canvas-shell" className="canvas-shell">
          <canvas key="map-canvas" className="map-canvas" data-redevplugin-canvas={CANVAS_ID} tabindex={0} autofocus={true} aria-label={t.app}></canvas>
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
                {toolButton('import-document', 'import', t.importLabel)}
                {toolButton('export-document', 'export', t.exportLabel)}
              </div>
            </nav>
          </header>
          {loadState === 'ready' ? <span key="save-state" className={saveState === 'error' || saveState === 'conflict' ? 'save-pill is-error' : saveState === 'saving' ? 'save-pill is-saving' : 'save-pill'} role="status"><span key="save-dot" className="save-dot"></span>{saveLabel()}</span> : null}
          <p key="canvas-hint" id="canvas-hint" className="shortcut-pill"><kbd key="tab-key">Tab</kbd><span key="tab-label">{t.child}</span><span key="hint-divider-1">·</span><kbd key="enter-key">Enter</kbd><span key="enter-label">{t.sibling}</span><span key="hint-divider-2">·</span><kbd key="f2-key">F2</kbd><span key="f2-label">{t.rename}</span></p>
          <div key="color-panel" className="color-panel" aria-label={t.colors}>
            <span key="color-label" className="color-label">{t.colors}</span>
            {NODE_COLORS.map((color) => (
              <button key={`color-${color}`} className={`color-button color-${color}`} type="button" value={color} aria-label={color} aria-pressed={selected.color === color} data-redevplugin-action="set-node-color"></button>
            ))}
          </div>
          {loadState === 'ready' && saveState === 'conflict' ? conflictNotice() : null}
          {loadState === 'ready' && saveState === 'error' ? errorNotice() : null}
          {loadState === 'ready' && modal ? modalView(modal) : null}
        </div>
      </section>
      {loadState !== 'ready' ? startupOverlay() : null}
    </main>
  );
}

function toolButton(action: string, icon: string, label: string, disabled = false, pressed?: boolean) {
  return <button key={`tool-${action}`} className="tool-button" type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} data-redevplugin-action={action}><span key={`tool-${action}-icon`} className={`tool-icon lucide-icon icon-${icon}`}></span></button>;
}

function sideActionButton(action: string, icon: string, label: string, disabled = false) {
  return <button key={`side-${action}`} className="side-action-button" type="button" title={label} aria-label={label} disabled={disabled} data-redevplugin-action={action}><span key={`side-${action}-icon`} className={`tool-icon lucide-icon icon-${icon}`}></span></button>;
}

function startupOverlay() {
  const t = text();
  const failed = loadState === 'error';
  return (
    <div key="startup-overlay" className="startup-overlay" role={failed ? 'alert' : 'status'}>
      <div key="startup-card" className={failed ? 'startup-card is-error' : 'startup-card'}>
        <span key="startup-mark" className="startup-mark" aria-hidden="true"><span key="startup-core"></span></span>
        <strong key="startup-title">{failed ? t.loadFailedTitle : t.loading}</strong>
        <p key="startup-message">{failed ? loadMessage || t.loadFailed : t.loadingBody}</p>
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

function modalView(current: Modal) {
  const t = text();
  const details = modalDetails(current);
  const isText = current.kind === 'import' || current.kind === 'export';
  const isDelete = current.kind === 'delete-document' || current.kind === 'delete-node';
  return (
    <div key="modal-backdrop" className="modal-backdrop" role="presentation">
      <form key="modal-card" className="modal-card" data-redevplugin-action="submit-modal">
        <h2 key="modal-title">{details.title}</h2>
        {details.body ? <p key="modal-body">{details.body}</p> : null}
        {isText
          ? <textarea key="modal-value" name="value" maxlength={MAX_IMPORT_BYTES} readonly={current.kind === 'export'} autofocus={true} aria-label={details.label}>{current.text}</textarea>
          : isDelete
            ? null
            : <input key="modal-value" type="text" name="value" value={current.title} maxlength={current.kind === 'rename-node' ? 120 : 80} autocomplete="off" autofocus={true} aria-label={details.label}></input>}
        <div key="modal-actions" className="modal-actions">
          <button key="cancel-modal" className="tool-button" type="button" data-redevplugin-action="cancel-modal">{current.kind === 'export' ? t.close : t.cancel}</button>
          {current.kind === 'export' ? null : <button key="submit-modal" className={isDelete ? 'danger-button' : 'primary-button'} type="submit">{details.action}</button>}
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
    case 'rename-node': return { title: t.renameNode, body: '', label: t.topic, action: t.save };
    case 'delete-document': return { title: t.deleteMapTitle, body: t.deleteMapBody, label: '', action: t.confirmDelete };
    case 'delete-node': return { title: t.deleteNodeTitle, body: `${t.deleteNodeBody} (${current.count})`, label: '', action: t.confirmDelete };
    case 'import': return { title: t.importTitle, body: t.importBody, label: t.importTitle, action: t.importAction };
    case 'export': return { title: t.exportTitle, body: t.exportBody, label: t.exportTitle, action: t.close };
  }
}

function submitModal(event: PluginUIActionEvent): void {
  if (!modal || modal.kind === 'export') return;
  const value = String(event.form_data?.value ?? '').trim();
  try {
    if (modal.kind === 'new-document') {
      runMutation((draft) => addDocument(draft, value || undefined).nodes[0].id, true);
    } else if (modal.kind === 'rename-document') {
      runMutation((draft) => renameDocument(selectedDocument(draft), value) ? selectedNodeID : undefined);
    } else if (modal.kind === 'rename-node') {
      runMutation((draft) => renameNode(selectedDocument(draft), selectedNodeID, value) ? selectedNodeID : undefined);
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
  modal = next;
  void render();
}

function closeModal(): void {
  modal = undefined;
  void render();
  draw();
}

async function selectMap(event: PluginUIActionEvent): Promise<void> {
  if (loadState !== 'ready') return;
  const id = String(event.value ?? '');
  if (!workspace.documents.some((document) => document.id === id) || id === workspace.selected_document_id) return;
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
  const node = currentDocument().nodes.find((candidate) => candidate.id === selectedNodeID);
  if (node) openModal({ kind: 'rename-node', title: node.title });
}

function addSelectedChild(): void {
  runMutation((draft) => addChild(selectedDocument(draft), selectedNodeID).id);
}

function addSelectedSibling(): void {
  runMutation((draft) => addSibling(selectedDocument(draft), selectedNodeID).id);
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

function resizeSidebar(value: string): void {
  const next = normalizeSidebarWidth(Number(value));
  if (next === sidebarWidth) return;
  sidebarWidth = next;
  nodeContextMenu = undefined;
  void render();
}

function runMutation(mutator: (draft: MindMapWorkspace) => string | undefined, immediateSave = false): void {
  if (loadState !== 'ready') return;
  nodeContextMenu = undefined;
  try {
    const draft = clone(workspace);
    const nextSelected = mutator(draft);
    validateWorkspace(draft);
    if (JSON.stringify(draft) === JSON.stringify(workspace)) return;
    workspace = draft;
    history.commit(workspace);
    ensureSelection(nextSelected);
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
        workspace: snapshot,
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
    validateWorkspace(response.data.workspace);
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
  workspace = clone(response.workspace);
  revision = response.revision;
  savedAt = response.saved_at;
  history = createHistory(workspace);
  selectedNodeID = selectedDocument(workspace).nodes[0].id;
  dirty = false;
  saveMessage = '';
  modal = undefined;
  centerMap(false);
}

async function reloadLatest(): Promise<void> {
  if (loadState !== 'ready') return;
  try {
    const response = await bridge.call<PluginMethodResult<LoadResponse>>('mindmap.workspace.load', {});
    validateWorkspace(response.data.workspace);
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
    validateWorkspace(response.data.workspace);
    const remote = clone(response.data.workspace);
    const recovered = importDocument(exportDocument(localDocument), remote, Date.now());
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
    return;
  }
  if (loadState !== 'ready' || modal) return;
  if (event.type === 'blur') {
    pointer = undefined;
    dropTarget = undefined;
    draw();
    return;
  }
  if (event.type === 'key' && event.event === 'keydown' && !event.repeat) handleKey(event);
  if (event.type === 'pointer') handlePointer(event);
}

function handleKey(event: Extract<PluginCanvasInputEvent, { type: 'key' }>): void {
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
    const hit = hitNode(world.x, world.y);
    if (hit) {
      selectedNodeID = hit.id;
      pointer = {
        pointerID: event.pointerId, kind: 'node', nodeID: hit.id, startX: event.x, startY: event.y,
        startPanX: viewport.x, startPanY: viewport.y, moved: false,
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
  else if (hit === 3) runMutation((draft) => toggleCollapsed(selectedDocument(draft), selectedNodeID) ? selectedNodeID : undefined);
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
  context.fillText(fittedTitle(node.title, CONTEXT_MENU_WIDTH - 28), menu.x + 14, menu.y + 18, CONTEXT_MENU_WIDTH - 28);

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
  const layout = layoutDocument(currentDocument());
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
  drawGrid();
  if (loadState !== 'ready') return;
  context.save();
  context.translate(cssWidth / 2 + viewport.x, cssHeight / 2 + viewport.y);
  context.scale(viewport.zoom, viewport.zoom);
  const layout = layoutDocument(currentDocument());
  drawEdges(layout);
  drawNodes(layout);
  if (currentDocument().nodes.length === 1) drawFirstBranchHint(layout);
  context.restore();
  if (nodeContextMenu) drawNodeContextMenu();
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
    const startX = from.x + (edge.side === 'right' ? from.width / 2 : -from.width / 2);
    const endX = to.x + (edge.side === 'right' ? -to.width / 2 : to.width / 2);
    const bend = Math.abs(endX - startX) * 0.48;
    const fromColor = nodeColor(fromNode.color);
    const toColor = nodeColor(toNode.color);
    const stroke = context.createLinearGradient(startX, from.y, endX, to.y);
    stroke.addColorStop(0, withAlpha(fromColor, from.depth === 0 ? 0.34 : 0.58));
    stroke.addColorStop(1, withAlpha(toColor, to.depth <= 1 ? 0.88 : 0.72));
    context.lineWidth = (to.depth === 1 ? 2.6 : to.depth === 2 ? 1.8 : 1.45) / viewport.zoom;
    context.strokeStyle = stroke;
    context.beginPath();
    context.moveTo(startX, from.y);
    context.bezierCurveTo(startX + (edge.side === 'right' ? bend : -bend), from.y, endX - (edge.side === 'right' ? bend : -bend), to.y, endX, to.y);
    context.stroke();
  }
}

function drawNodes(layout: DocumentLayout): void {
  if (!context) return;
  const document = currentDocument();
  for (const box of layout.nodes.values()) {
    const node = document.nodes.find((candidate) => candidate.id === box.id);
    if (!node) continue;
    const selected = node.id === selectedNodeID;
    const isDropParent = dropTarget?.parentID === node.id;
    context.save();
    if (selected) drawSelectionHalo(box);
    const accent = nodeColor(node.color);
    context.shadowColor = selected ? withAlpha(colors.focus, 0.18) : withAlpha('#000000', box.depth === 0 ? 0.18 : box.depth === 1 ? 0.1 : 0.045);
    context.shadowBlur = box.depth === 0 ? 24 : selected ? 16 : box.depth === 1 ? 10 : 5;
    context.shadowOffsetY = box.depth === 0 ? 8 : box.depth === 1 ? 4 : 2;
    roundedRect(context, box.x - box.width / 2, box.y - box.height / 2, box.width, box.height, box.depth === 0 ? 14 : box.depth === 1 ? 11 : 8);
    if (box.depth === 0) {
      const rootFill = context.createLinearGradient(box.x - box.width / 2, box.y - box.height / 2, box.x + box.width / 2, box.y + box.height / 2);
      rootFill.addColorStop(0, mixColor(nodeColor(node.color), '#ffffff', 0.14));
      rootFill.addColorStop(1, mixColor(nodeColor(node.color), '#000000', 0.1));
      context.fillStyle = rootFill;
    } else if (box.depth === 1) context.fillStyle = mixColor(colors.surface_elevated, accent, 0.13);
    else if (box.depth === 2) context.fillStyle = mixColor(colors.surface_elevated, accent, 0.052);
    else context.fillStyle = mixColor(colors.canvas, accent, 0.035);
    context.fill();
    context.shadowColor = 'transparent';
    context.lineWidth = (isDropParent ? 2.5 : 1) / viewport.zoom;
    context.strokeStyle = isDropParent ? colors.success : box.depth === 0 ? withAlpha('#ffffff', 0.22) : withAlpha(accent, selected ? 0.62 : box.depth === 1 ? 0.26 : 0.16);
    context.stroke();

    if (box.depth > 0) {
      const railWidth = box.depth === 1 ? 3 : 2;
      const railX = box.side === 'left' ? box.x + box.width / 2 - railWidth - 2 : box.x - box.width / 2 + 2;
      const railHeight = box.depth === 1 ? Math.min(24, box.height - 14) : Math.min(16, box.height - 14);
      roundedRect(context, railX, box.y - railHeight / 2, railWidth, railHeight, 2);
      context.fillStyle = accent;
      context.fill();
    }

    context.fillStyle = box.depth === 0 ? contrastText(nodeColor(node.color)) : colors.text;
    context.font = `${box.depth === 0 ? 720 : box.depth === 1 ? 660 : 560} ${box.depth === 0 ? 15.5 : box.depth === 1 ? 13.5 : 12}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fittedTitle(node.title, box.width - 30), box.x, box.y, box.width - 30);
    if (hasChildren(document, node.id)) {
      const badgeX = box.x + (box.side === 'left' && box.depth > 0 ? -box.width / 2 : box.width / 2);
      context.beginPath();
      context.arc(badgeX, box.y, 7.5, 0, Math.PI * 2);
      context.fillStyle = colors.surface;
      context.fill();
      context.lineWidth = 1.25 / viewport.zoom;
      context.strokeStyle = withAlpha(accent, 0.68);
      context.stroke();
      context.fillStyle = accent;
      context.font = '700 10px system-ui, sans-serif';
      context.fillText(node.collapsed ? '+' : '−', badgeX, box.y + 0.5);
    }
    context.restore();
  }
  if (dropTarget && pointer?.kind === 'node') drawDropLabel(layout);
}

function drawSelectionHalo(box: LayoutNode): void {
  if (!context) return;
  context.save();
  context.shadowColor = withAlpha(colors.focus, 0.32);
  context.shadowBlur = 16;
  roundedRect(context, box.x - box.width / 2 - 4, box.y - box.height / 2 - 4, box.width + 8, box.height + 8, box.depth === 0 ? 17 : box.depth === 1 ? 14 : 11);
  context.lineWidth = 1.5 / viewport.zoom;
  context.strokeStyle = withAlpha(colors.focus, 0.48);
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
  const nodes = [...layoutDocument(currentDocument()).nodes.values()].reverse();
  return nodes.find((box) => box.id !== excludedID && x >= box.x - box.width / 2 && x <= box.x + box.width / 2 && y >= box.y - box.height / 2 && y <= box.y + box.height / 2);
}

function screenToWorld(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - cssWidth / 2 - viewport.x) / viewport.zoom,
    y: (y - cssHeight / 2 - viewport.y) / viewport.zoom,
  };
}

function centerMap(renderUI = true): void {
  viewport = fitLayoutToViewport(layoutDocument(currentDocument()), cssWidth, cssHeight, viewportPadding());
  draw();
  if (renderUI) void render();
}

function revealSelection(): void {
  const box = layoutDocument(currentDocument()).nodes.get(selectedNodeID);
  if (!box) return;
  const padding = viewportPadding();
  const left = cssWidth / 2 + viewport.x + (box.x - box.width / 2) * viewport.zoom;
  const right = cssWidth / 2 + viewport.x + (box.x + box.width / 2) * viewport.zoom;
  const top = cssHeight / 2 + viewport.y + (box.y - box.height / 2) * viewport.zoom;
  const bottom = cssHeight / 2 + viewport.y + (box.y + box.height / 2) * viewport.zoom;
  if (left < padding.left) viewport.x += padding.left - left;
  else if (right > cssWidth - padding.right) viewport.x -= right - (cssWidth - padding.right);
  if (top < padding.top) viewport.y += padding.top - top;
  else if (bottom > cssHeight - padding.bottom) viewport.y -= bottom - (cssHeight - padding.bottom);
}

function viewportPadding(): ViewportPadding {
  return { top: cssWidth < 520 ? 108 : 76, right: 28, bottom: 68, left: 28 };
}

function setZoom(value: number): void {
  if (loadState !== 'ready') return;
  viewport.zoom = Math.max(0.42, Math.min(2.4, value));
  draw();
  void render();
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

function nodeColor(color: NodeColor): string {
  if (color === 'accent') return colors.accent;
  if (color === 'blue') return '#5f86ee';
  if (color === 'green') return '#43b990';
  if (color === 'amber') return '#e6a23c';
  if (color === 'rose') return '#e9687d';
  return '#8d6de8';
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

function fittedTitle(title: string, width: number): string {
  if (!context || context.measureText(title).width <= width) return title;
  const characters = [...title];
  while (characters.length > 1 && context.measureText(`${characters.join('')}…`).width > width) characters.pop();
  return `${characters.join('')}…`;
}

function roundedRect(target: OffscreenCanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
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
