import {
  PluginBridgeClient,
  PluginBridgeError,
  type PluginCanvasInputEvent,
  type PluginCanvasPointerEvent,
  type PluginMethodResult,
  type PluginSurfaceContext,
  type PluginUIActionEvent,
} from '@floegence/redevplugin-ui/plugin';
import { layoutDocument, type DocumentLayout, type LayoutNode } from './layout.js';
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
type SaveState = 'loading' | 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
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
let saveState: SaveState = 'loading';
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
let pointer: PointerGesture | undefined;
let dropTarget: DropTarget | undefined;
let visible = true;
let disposed = false;
let initialized = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveInFlight: Promise<boolean> | undefined;
let renderQueue = Promise.resolve();
let lastClick = { nodeID: '', time: 0 };

const COPY = {
  en: {
    app: 'Mind Map', maps: 'Maps', newMap: 'New map', rename: 'Rename', duplicate: 'Duplicate', remove: 'Delete',
    undo: 'Undo', redo: 'Redo', bilateral: 'Both sides', right: 'Right only', child: 'Child', sibling: 'Sibling',
    collapse: 'Fold / unfold', importLabel: 'Import', exportLabel: 'Export', center: 'Center', loading: 'Loading workspace…',
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
  },
  zh: {
    app: '思维导图', maps: '导图', newMap: '新建', rename: '重命名', duplicate: '复制', remove: '删除',
    undo: '撤销', redo: '重做', bilateral: '双向', right: '向右', child: '子节点', sibling: '同级节点',
    collapse: '折叠 / 展开', importLabel: '导入', exportLabel: '导出', center: '居中', loading: '正在载入工作区…',
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
    statusReady: '可编辑', zoomIn: '放大', zoomOut: '缩小',
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
bridge.onAction('cancel-modal', () => closeModal());
bridge.onAction('submit-modal', (event) => submitModal(event));
bridge.onAction('reload-conflict', () => void reloadLatest());
bridge.onAction('recover-conflict', () => void recoverLocalCopy());
bridge.onAction('retry-save', () => void flushSave());
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
    await flushSave();
    return;
  }
  if (event.type === 'dispose') {
    visible = false;
    clearSaveTimer();
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
  await reloadLatest();
  initialized = true;
  saveState = 'idle';
  await bridge.updateCanvasAccessibility(CANVAS_ID, {
    label: text().app,
    description: text().hint,
  });
  await render();
  draw();
}

async function showFatal(error: unknown): Promise<void> {
  saveState = 'error';
  saveMessage = error instanceof Error ? error.message : text().operationFailed;
  initialized = true;
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
    <main key="mind-map-root" className="mind-map-app">
      <aside key="document-sidebar" className="document-sidebar" aria-label={t.maps}>
        <header key="sidebar-heading" className="sidebar-heading">
          <strong key="sidebar-title">{t.maps}</strong>
          <button key="new-document" className="icon-button" type="button" title={t.newMap} aria-label={t.newMap} data-redevplugin-action="new-document">＋</button>
        </header>
        <ul key="document-list" className="document-list">
          {workspace.documents.map((item, index) => (
            <li key={`document-item-${index}`}>
              <button key={`document-${index}`} className={item.id === workspace.selected_document_id ? 'document-button is-active' : 'document-button'} type="button" value={item.id} aria-pressed={item.id === workspace.selected_document_id} data-redevplugin-action="select-document">
                <span key={`document-label-${index}`}>{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <footer key="sidebar-footer" className="sidebar-footer">
          <button key="rename-document" className="tool-button" type="button" data-redevplugin-action="rename-document">{t.rename}</button>
          <button key="duplicate-document" className="tool-button" type="button" data-redevplugin-action="duplicate-document">{t.duplicate}</button>
          <button key="delete-document" className="tool-button" type="button" disabled={workspace.documents.length <= 1} data-redevplugin-action="delete-document">{t.remove}</button>
        </footer>
      </aside>
      <section key="editor-shell" className="editor-shell">
        <header key="toolbar" className="toolbar" aria-label={t.app}>
          <div key="history-tools" className="toolbar-group">
            {toolButton('undo', '↶', t.undo, history.undo.length === 0)}
            {toolButton('redo', '↷', t.redo, history.redo.length === 0)}
          </div>
          <div key="structure-tools" className="toolbar-group">
            {toolButton('add-child', '＋', t.child)}
            {toolButton('add-sibling', '≡＋', t.sibling)}
            {toolButton('rename-node', '✎', t.rename)}
            {toolButton('toggle-collapse', '⌁', t.collapse, !hasChildren(document, selected.id))}
            {toolButton('delete-node', '⌫', t.remove, selected.parent_id === null)}
          </div>
          <div key="layout-tools" className="toolbar-group">
            {toolButton('layout-bilateral', '↔', t.bilateral, false, document.layout === 'bilateral')}
            {toolButton('layout-right', '→', t.right, false, document.layout === 'right')}
          </div>
          <div key="viewport-tools" className="toolbar-group">
            {toolButton('zoom-out', '−', t.zoomOut)}
            {toolButton('zoom-in', '＋', t.zoomIn)}
            {toolButton('center-map', '◎', t.center)}
          </div>
          <div key="file-tools" className="toolbar-group">
            {toolButton('import-document', '⇧', t.importLabel)}
            {toolButton('export-document', '⇩', t.exportLabel)}
          </div>
          <span key="save-state" className={saveState === 'error' || saveState === 'conflict' ? 'save-state is-error' : 'save-state'} role="status">{saveLabel()}</span>
        </header>
        <div key="canvas-shell" className="canvas-shell">
          <canvas key="map-canvas" className="map-canvas" data-redevplugin-canvas={CANVAS_ID} tabindex={0} autofocus={true} aria-label={t.app}></canvas>
          <p key="canvas-hint" id="canvas-hint" className="canvas-hint">{t.hint}</p>
          <div key="color-panel" className="color-panel" aria-label="Node color">
            {NODE_COLORS.map((color) => (
              <button key={`color-${color}`} className={`color-button color-${color}`} type="button" value={color} aria-label={color} aria-pressed={selected.color === color} data-redevplugin-action="set-node-color"></button>
            ))}
          </div>
          {!initialized ? notice('loading-notice', t.loading) : null}
          {saveState === 'conflict' ? conflictNotice() : null}
          {saveState === 'error' ? errorNotice() : null}
          {modal ? modalView(modal) : null}
        </div>
      </section>
    </main>
  );
}

function toolButton(action: string, symbol: string, label: string, disabled = false, pressed?: boolean) {
  return <button key={`tool-${action}`} className="tool-button" type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} data-redevplugin-action={action}>{symbol}<span key={`tool-${action}-label`}>{label}</span></button>;
}

function notice(key: string, message: string) {
  return <div key={key} className="notice-banner" role="status"><span key={`${key}-message`}>{message}</span></div>;
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
  modal = next;
  void render();
}

function closeModal(): void {
  modal = undefined;
  void render();
  draw();
}

async function selectMap(event: PluginUIActionEvent): Promise<void> {
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

function runMutation(mutator: (draft: MindMapWorkspace) => string | undefined, immediateSave = false): void {
  try {
    const draft = clone(workspace);
    const nextSelected = mutator(draft);
    validateWorkspace(draft);
    if (JSON.stringify(draft) === JSON.stringify(workspace)) return;
    workspace = draft;
    history.commit(workspace);
    ensureSelection(nextSelected);
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
  const next = undoHistory(history, workspace);
  if (next === workspace) return;
  workspace = next;
  ensureSelection();
  markDirty(false);
  void render();
  draw();
}

function redo(): void {
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
  dirty = true;
  editVersion += 1;
  if (saveState !== 'conflict') saveState = 'dirty';
  clearSaveTimer();
  if (immediate) void flushSave();
  else saveTimer = setTimeout(() => { saveTimer = undefined; void flushSave(); }, 400);
}

async function flushSave(): Promise<void> {
  clearSaveTimer();
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

async function reloadLatest(): Promise<void> {
  try {
    const response = await bridge.call<PluginMethodResult<LoadResponse>>('mindmap.workspace.load', {});
    validateWorkspace(response.data.workspace);
    workspace = clone(response.data.workspace);
    revision = response.data.revision;
    savedAt = response.data.saved_at;
    history = createHistory(workspace);
    selectedNodeID = selectedDocument(workspace).nodes[0].id;
    dirty = false;
    saveState = initialized ? 'saved' : 'idle';
    saveMessage = '';
    modal = undefined;
    centerMap(false);
  } catch (error) {
    saveState = 'error';
    saveMessage = error instanceof Error ? error.message : text().operationFailed;
  }
  await render();
  draw();
}

async function recoverLocalCopy(): Promise<void> {
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
  if (!initialized || modal) return;
  if (event.type === 'resize') {
    cssWidth = event.cssWidth;
    cssHeight = event.cssHeight;
    devicePixelRatio = event.devicePixelRatio;
    configureCanvas();
    draw();
    return;
  }
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
  context.fillStyle = colors.canvas;
  context.fillRect(0, 0, cssWidth, cssHeight);
  drawGrid();
  context.save();
  context.translate(cssWidth / 2 + viewport.x, cssHeight / 2 + viewport.y);
  context.scale(viewport.zoom, viewport.zoom);
  const layout = layoutDocument(currentDocument());
  drawEdges(layout);
  drawNodes(layout);
  context.restore();
}

function drawGrid(): void {
  if (!context) return;
  const gap = Math.max(18, 28 * viewport.zoom);
  const offsetX = ((cssWidth / 2 + viewport.x) % gap + gap) % gap;
  const offsetY = ((cssHeight / 2 + viewport.y) % gap + gap) % gap;
  context.fillStyle = withAlpha(colors.text_muted, 0.16);
  for (let x = offsetX; x < cssWidth; x += gap) {
    for (let y = offsetY; y < cssHeight; y += gap) context.fillRect(x, y, 1, 1);
  }
}

function drawEdges(layout: DocumentLayout): void {
  if (!context) return;
  context.lineWidth = 2 / viewport.zoom;
  context.strokeStyle = withAlpha(colors.text_muted, 0.38);
  for (const edge of layout.edges) {
    const from = layout.nodes.get(edge.from);
    const to = layout.nodes.get(edge.to);
    if (!from || !to) continue;
    const startX = from.x + (edge.side === 'right' ? from.width / 2 : -from.width / 2);
    const endX = to.x + (edge.side === 'right' ? -to.width / 2 : to.width / 2);
    const bend = Math.abs(endX - startX) * 0.48;
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
    context.shadowColor = selected ? withAlpha(colors.focus, 0.28) : '#00000016';
    context.shadowBlur = selected ? 16 : 10;
    context.shadowOffsetY = 3;
    roundedRect(context, box.x - box.width / 2, box.y - box.height / 2, box.width, box.height, box.depth === 0 ? 14 : 11);
    context.fillStyle = box.depth === 0 ? nodeColor(node.color) : colors.surface_elevated;
    context.fill();
    context.shadowColor = 'transparent';
    context.lineWidth = (selected ? 2.5 : 1) / viewport.zoom;
    context.strokeStyle = isDropParent ? colors.success : selected ? colors.focus : withAlpha(nodeColor(node.color), 0.7);
    context.stroke();
    context.fillStyle = box.depth === 0 ? contrastText(nodeColor(node.color)) : colors.text;
    context.font = `${box.depth === 0 ? 700 : 600} ${box.depth === 0 ? 15 : 13}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fittedTitle(node.title, box.width - 30), box.x, box.y, box.width - 30);
    if (hasChildren(document, node.id)) {
      const badgeX = box.x + (box.side === 'left' && box.depth > 0 ? -box.width / 2 : box.width / 2);
      context.beginPath();
      context.arc(badgeX, box.y, 8, 0, Math.PI * 2);
      context.fillStyle = colors.surface;
      context.fill();
      context.strokeStyle = withAlpha(nodeColor(node.color), 0.85);
      context.stroke();
      context.fillStyle = colors.text_muted;
      context.font = '700 10px system-ui, sans-serif';
      context.fillText(node.collapsed ? '+' : '−', badgeX, box.y + 0.5);
    }
    context.restore();
  }
  if (dropTarget && pointer?.kind === 'node') drawDropLabel(layout);
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
  viewport = { x: 0, y: 0, zoom: 1 };
  draw();
  if (renderUI) void render();
}

function setZoom(value: number): void {
  viewport.zoom = Math.max(0.42, Math.min(2.4, value));
  draw();
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
  if (saveState === 'loading') return t.loading;
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
