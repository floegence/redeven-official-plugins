import { For, Show, createSignal, onMount, type Component } from "solid-js";
import { render as mount } from "solid-js/web";
import { FloeProvider } from "@floegence/floe-webapp-core/app";
import { useTheme } from "@floegence/floe-webapp-core";
import {
  Button,
  Dialog,
  Dropdown,
  Input,
} from "@floegence/floe-webapp-core/ui";
import {
  Plus,
  Minus,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  GitBranch,
  Pencil,
  Trash,
  Copy,
  Download,
  Upload,
  Maximize,
  ChevronDown,
  Menu,
} from "@floegence/floe-webapp-core/icons";
import "@floegence/floe-webapp-core/styles";
import "../styles.css";
import { prepareDocumentEdit, type DocumentEdit } from "./document-actions";
import { reconcilePendingSave } from "./save-reconciliation";
import {
  PluginBridgeClient,
  PluginBridgeError,
  type PluginMethodResult,
  type PluginSurfaceContext,
} from "@floegence/redevplugin-ui/plugin";
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
} from "./layout.js";
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
  wheelZoomTarget,
  zoomViewportAtPoint,
} from "./editor-ui.js";
import { loadWithRetry } from "./startup-load.js";
import {
  EXPORT_FORMATS,
  bitmapExportSize,
  exportLayoutBounds,
  nodeColorValue,
  safeExportBaseName,
  serializeMindMapSVG,
  type ExportFormat,
} from "./export.js";
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
} from "./workspace-model.js";

type Locale = "en" | "zh";
type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type Modal =
  | { kind: "new-document"; title: string }
  | { kind: "rename-document"; title: string }
  | { kind: "delete-document"; title: string }
  | { kind: "delete-node"; title: string; count: number }
  | { kind: "import"; text: string };
type Viewport = { x: number; y: number; zoom: number };
type DropTarget = {
  parentID: string;
  order: number;
  side?: BranchSide;
  label: string;
};
type NodeContextMenu = { nodeID: string; x: number; y: number; hover: number };
type NodeTitleEditor = { nodeID: string; draft: string; isComposing: boolean };
type PointerGesture = {
  pointerID: number;
  kind: "pan" | "node";
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
type LoadResponse = {
  revision: number;
  saved_at: string | null;
  workspace_dsl: string;
};
type SaveResponse = { revision: number; saved_at: string };

const bridge = new PluginBridgeClient({ timeoutMs: 20_000 });
const CANVAS_ID = "map";
const NODE_COLORS: readonly NodeColor[] = [
  "accent",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
];
const NODE_ALIGNMENTS: readonly NodeAlignment[] = ["left", "center", "right"];
const DEFAULT_COLORS: PluginSurfaceContext["appearance"]["colors"] = {
  canvas: "#f6f7fb",
  surface: "#ffffff",
  surface_elevated: "#ffffff",
  text: "#202532",
  text_muted: "#737b8c",
  border: "#dfe3eb",
  accent: "#5865d8",
  accent_text: "#ffffff",
  success: "#2d9b75",
  warning: "#c78722",
  danger: "#cf4c62",
  focus: "#5865d8",
};

let workspace = createWorkspace(1);
let history: WorkspaceHistory = createHistory(workspace);
let revision = 0;
let savedAt: string | null = null;
let loadState: LoadState = "loading";
let loadMessage = "";
let saveState: SaveState = "idle";
let saveMessage = "";
let dirty = false;
let editVersion = 0;
let selectedNodeID = selectedDocument(workspace).nodes[0].id;
let modal: Modal | undefined;
let modalError = "";
let nodeTitleEditor: NodeTitleEditor | undefined;
let exportBusy = false;
let exportMessage = "";
let exportRendering = false;
let locale: Locale = "en";
let colors = DEFAULT_COLORS;
type DrawingCanvas = HTMLCanvasElement;
type DrawingContext = CanvasRenderingContext2D;

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
let pendingSave:
  | { revision: number; workspace_dsl: string; editVersion: number }
  | undefined;
const [viewVersion, setViewVersion] = createSignal(0);
const observe =
  <T,>(read: () => T) =>
  () => {
    viewVersion();
    return read();
  };
let canvasElement!: HTMLCanvasElement;
let resizeObserver: ResizeObserver;
let setAppTheme: ((theme: "light" | "dark") => void) | undefined;
let sidebarOpen = false;
let lastClick = { nodeID: "", time: 0 };

const COPY = {
  en: {
    app: "Mind Map",
    maps: "Maps",
    newMap: "New map",
    rename: "Rename",
    duplicate: "Duplicate",
    remove: "Delete",
    workspace: "Workspace",
    documents: "maps",
    topics: "topics",
    selectedMap: "Current map",
    undo: "Undo",
    redo: "Redo",
    switchToBilateral: "Switch to both sides",
    switchToRight: "Switch to right only",
    child: "Child",
    sibling: "Sibling",
    collapse: "Fold / unfold",
    importLabel: "Import file",
    exportLabel: "Export file",
    center: "Center",
    loading: "Restoring your workspace…",
    loadFailedTitle: "Workspace is still unavailable",
    loadFailed: "Your saved data was not changed. Try loading it again.",
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved changes",
    saveFailed: "Save failed — changes remain here",
    conflict: "A newer workspace was saved elsewhere.",
    reload: "Reload latest",
    recover: "Keep mine as copy",
    retry: "Retry",
    hint: "Tab child · Enter sibling · F2 rename · Drag a node to reorganize · Drag empty space to pan",
    newTitle: "Create a mind map",
    renameMap: "Rename mind map",
    renameNode: "Rename topic",
    mapName: "Map name",
    topic: "Topic",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    confirmDelete: "Delete",
    deleteMapTitle: "Delete this mind map?",
    deleteNodeTitle: "Delete this branch?",
    deleteMapBody: "You can undo this while the workspace remains open.",
    deleteNodeBody:
      "The selected topic and all topics below it will be removed.",
    importTitle: "Import mind map DSL",
    importBody:
      "Paste a mind-map 1 document. Legacy mind-map.document.v1 JSON is migrated once.",
    importAction: "Import as new map",
    invalidImport: "The DSL is invalid or exceeds the supported limits.",
    operationFailed: "The operation could not be completed.",
    rootCannotDelete: "The central topic cannot be deleted.",
    recovered: "Recovered copy",
    dropInside: "Move inside",
    dropBefore: "Move before",
    dropAfter: "Move after",
    statusReady: "Ready",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    firstBranch: "Press Tab to shape your first branch",
    canvasTools: "Map editing tools",
    colors: "Topic color",
    nodeStyle: "Topic style",
    textAlignment: "Text alignment",
    alignLeft: "Align text left",
    alignCenter: "Center text",
    alignRight: "Align text right",
    nodeActions: "Topic actions",
    narrowSidebar: "Narrow map sidebar",
    widenSidebar: "Widen map sidebar",
    exportFormat: "Choose export format",
    exportPNG: "PNG image",
    exportJPEG: "JPEG image",
    exportWebP: "WebP image",
    exportSVG: "SVG image",
    exportDSL: "Mind map DSL",
    exportFailed: "The file could not be exported. Try again.",
    dismiss: "Dismiss",
    colorAccent: "Accent",
    colorBlue: "Blue",
    colorGreen: "Green",
    colorAmber: "Amber",
    colorRose: "Rose",
    colorViolet: "Violet",
  },
  zh: {
    app: "思维导图",
    maps: "导图",
    newMap: "新建",
    rename: "重命名",
    duplicate: "复制",
    remove: "删除",
    workspace: "工作空间",
    documents: "张导图",
    topics: "个节点",
    selectedMap: "当前导图",
    undo: "撤销",
    redo: "重做",
    switchToBilateral: "切换为双向布局",
    switchToRight: "切换为向右布局",
    child: "子节点",
    sibling: "同级节点",
    collapse: "折叠 / 展开",
    importLabel: "导入文件",
    exportLabel: "导出文件",
    center: "居中",
    loading: "正在恢复工作区…",
    loadFailedTitle: "工作区暂时不可用",
    loadFailed: "已保存的数据没有被修改，请重新载入。",
    saved: "已保存",
    saving: "正在保存…",
    unsaved: "有未保存修改",
    saveFailed: "保存失败，修改仍保留在本地界面",
    conflict: "其他窗口已保存了更新版本。",
    reload: "载入最新版本",
    recover: "将我的内容保留为副本",
    retry: "重试",
    hint: "Tab 新建子节点 · Enter 新建同级 · F2 重命名 · 拖动节点调整结构 · 拖动空白处平移",
    newTitle: "新建思维导图",
    renameMap: "重命名导图",
    renameNode: "重命名节点",
    mapName: "导图名称",
    topic: "节点标题",
    cancel: "取消",
    create: "创建",
    save: "保存",
    confirmDelete: "确认删除",
    deleteMapTitle: "删除这张导图？",
    deleteNodeTitle: "删除整个分支？",
    deleteMapBody: "关闭工作区前，你可以撤销此操作。",
    deleteNodeBody: "选中节点及其全部子节点都会被删除。",
    importTitle: "导入思维导图 DSL",
    importBody:
      "粘贴 mind-map 1 文档；旧版 mind-map.document.v1 JSON 仅迁移一次。",
    importAction: "作为新导图导入",
    invalidImport: "DSL 无效或超过支持范围。",
    operationFailed: "操作未能完成。",
    rootCannotDelete: "中心节点不能删除。",
    recovered: "恢复的副本",
    dropInside: "移入节点",
    dropBefore: "移到前面",
    dropAfter: "移到后面",
    statusReady: "可编辑",
    zoomIn: "放大",
    zoomOut: "缩小",
    firstBranch: "按 Tab 创建第一个分支",
    canvasTools: "导图编辑工具",
    colors: "节点颜色",
    nodeStyle: "节点样式",
    textAlignment: "文字对齐",
    alignLeft: "文字左对齐",
    alignCenter: "文字居中",
    alignRight: "文字右对齐",
    nodeActions: "节点操作",
    narrowSidebar: "收窄导图侧边栏",
    widenSidebar: "加宽导图侧边栏",
    exportFormat: "选择导出格式",
    exportPNG: "PNG 图片",
    exportJPEG: "JPEG 图片",
    exportWebP: "WebP 图片",
    exportSVG: "SVG 图片",
    exportDSL: "思维导图 DSL",
    exportFailed: "文件导出失败，请重试。",
    dismiss: "关闭提示",
    colorAccent: "主题色",
    colorBlue: "蓝色",
    colorGreen: "绿色",
    colorAmber: "琥珀色",
    colorRose: "玫红色",
    colorViolet: "紫色",
  },
} as const;

bridge.onBeforeClose(async function beforeClose() {
  if (nodeTitleEditor?.isComposing) return false;
  commitNodeTitleEdit();
  await flushSave();
  return !dirty && !nodeTitleEditor;
});
bridge.onLifecycle((event) => {
  if (event.type === "visible") {
    visible = true;
    resizeCanvas();
    draw();
  }
  if (event.type === "hidden") {
    visible = false;
    pointer = undefined;
    dropTarget = undefined;
  }
  if (event.type === "dispose") {
    disposed = true;
    surfaceDisposing = true;
    visible = false;
    clearSaveTimer();
    clearLoadRetryWait();
    clearViewportRenderTimer();
    resizeObserver?.disconnect();
    unmount();
    canvas = undefined;
    context = undefined;
  }
});

async function initialize(): Promise<void> {
  await bridge.ready();
  bridge.onContext((next) => {
    colors = next.appearance.colors;
    locale = next.locale.language_tag.toLowerCase().startsWith("zh")
      ? "zh"
      : "en";
    setAppTheme?.(next.appearance.color_scheme);
    for (const [key, value] of Object.entries(colors))
      document.documentElement.style.setProperty(
        "--redevplugin-color-" + key.replaceAll("_", "-"),
        value,
      );
    void render();
    draw();
  });
  canvas = canvasElement;
  const drawingContext = canvas.getContext("2d", { alpha: false });
  if (!drawingContext) throw new Error("2D canvas is unavailable");
  context = drawingContext;
  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(canvas);
  resizeCanvas();
  if (!(await loadWorkspaceAtStartup())) return;
  await activateLoadedWorkspace();
}
function resizeCanvas(): void {
  if (!canvas || disposed) return;
  cssWidth = canvas.clientWidth;
  cssHeight = canvas.clientHeight;
  devicePixelRatio = window.devicePixelRatio || 1;
  configureCanvas();
  revealSelection();
  draw();
  void render();
}

let applicationMethodsRegistered = false;
async function activateLoadedWorkspace(): Promise<void> {
  if (!applicationMethodsRegistered) {
    await registerApplicationMethods();
    applicationMethodsRegistered = true;
  }
  await updateCanvasAccessibility();
  await render();
  draw();
}

function updateCanvasAccessibility(): Promise<void> {
  canvasElement?.setAttribute("aria-label", text().app);
  return Promise.resolve();
}

async function showFatal(error: unknown): Promise<void> {
  loadState = "error";
  loadMessage = error instanceof Error ? error.message : text().loadFailed;
  try {
    await bridge.ready();
    await render();
  } catch {
    // The host owns the unavailable state when bridge startup itself fails.
  }
}

function IconButton(props: {
  label: string;
  icon: Component<{ size?: number }>;
  onClick: () => void;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <Button
      variant="ghost"
      class={"tool-button " + (props.class ?? "")}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <props.icon size={17} />
    </Button>
  );
}
function MindMapApp() {
  const theme = useTheme();
  setAppTheme = (value) => theme.setTheme(value);
  const t = observe(text),
    map = observe(currentDocument),
    selected = observe(
      () =>
        currentDocument().nodes.find((n) => n.id === selectedNodeID) ??
        currentDocument().nodes[0],
    );
  onMount(() => void initialize().catch(showFatal));
  return (
    <main
      class="mind-map-app"
      classList={{
        "is-starting": observe(() => loadState !== "ready")(),
        "sidebar-open": observe(() => sidebarOpen)(),
      }}
      style={{ "--sidebar-width": observe(() => sidebarWidth + "px")() }}
      lang={observe(() => locale)()}
    >
      <aside
        class="document-sidebar"
        aria-label={t().maps}
        data-floe-surface="flat"
      >
        <header class="sidebar-heading">
          <GitBranch size={21} />
          <strong>{t().maps}</strong>
          <IconButton
            class="sidebar-dismiss"
            label={t().cancel}
            icon={ArrowLeft}
            onClick={() => {
              sidebarOpen = false;
              void render();
            }}
          />
          <IconButton
            label={t().newMap}
            icon={Plus}
            onClick={() => openModal({ kind: "new-document", title: "" })}
          />
        </header>
        <ul class="document-list">
          <For each={observe(() => workspace.documents)()}>
            {(item) => (
              <li
                class="document-card"
                classList={{
                  "is-active": observe(
                    () => item.id === workspace.selected_document_id,
                  )(),
                }}
              >
                <button
                  class="document-button"
                  type="button"
                  aria-pressed={observe(
                    () => item.id === workspace.selected_document_id,
                  )()}
                  onClick={() => {
                    sidebarOpen = false;
                    void selectMap(item.id);
                  }}
                >
                  <GitBranch size={17} />
                  <span class="document-copy">
                    <strong>{item.title}</strong>
                    <small>
                      {item.nodes.length} {t().topics}
                    </small>
                  </span>
                </button>
                <Show
                  when={observe(
                    () => item.id === workspace.selected_document_id,
                  )()}
                >
                  <div class="document-actions">
                    <IconButton
                      label={t().rename}
                      icon={Pencil}
                      onClick={() =>
                        openModal({
                          kind: "rename-document",
                          title: currentDocument().title,
                        })
                      }
                    />
                    <IconButton
                      label={t().duplicate}
                      icon={Copy}
                      onClick={() =>
                        runMutation(
                          (draft) =>
                            duplicateDocument(draft, draft.selected_document_id)
                              .nodes[0].id,
                          true,
                        )
                      }
                    />
                    <IconButton
                      label={t().remove}
                      icon={Trash}
                      disabled={observe(
                        () => workspace.documents.length <= 1,
                      )()}
                      onClick={requestDeleteDocument}
                    />
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <footer class="sidebar-footer">
          <IconButton
            label={t().importLabel}
            icon={Upload}
            onClick={() => openModal({ kind: "import", text: "" })}
          />
          <span>Tab · Enter · F2</span>
        </footer>
        <div
          class="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t().maps}
          tabIndex={0}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={observe(() => sidebarWidth)()}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              adjustSidebar(
                e.key === "ArrowLeft"
                  ? -SIDEBAR_WIDTH_STEP
                  : SIDEBAR_WIDTH_STEP,
              );
            }
          }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              sidebarWidth = normalizeSidebarWidth(e.clientX);
              void render();
            }
          }}
        />
      </aside>
      <Show when={observe(() => sidebarOpen)()}>
        <button
          class="sidebar-scrim"
          aria-label={t().cancel}
          onClick={() => {
            sidebarOpen = false;
            void render();
          }}
        />
      </Show>
      <section class="editor-shell">
        <div class="canvas-shell">
          <canvas
            ref={canvasElement}
            class="map-canvas"
            tabIndex={0}
            aria-label={t().app}
            onPointerDown={nativePointer}
            onPointerMove={nativePointer}
            onPointerUp={nativePointer}
            onPointerCancel={nativePointer}
            onWheel={nativeWheel}
            onKeyDown={nativeKey}
            onContextMenu={(e) => e.preventDefault()}
          />
          <header class="canvas-command-deck" data-floe-surface="floating">
            <IconButton
              class="sidebar-toggle"
              label={t().maps}
              icon={Menu}
              onClick={() => {
                sidebarOpen = !sidebarOpen;
                void render();
              }}
            />
            <strong class="canvas-title">{map().title}</strong>
            <nav class="command-bar" aria-label={t().canvasTools}>
              <div class="command-cluster">
                <IconButton
                  label={t().undo}
                  icon={ArrowLeft}
                  disabled={observe(() => !history.undo.length)()}
                  onClick={undo}
                />
                <IconButton
                  label={t().redo}
                  icon={ArrowRight}
                  disabled={observe(() => !history.redo.length)()}
                  onClick={redo}
                />
              </div>
              <div class="command-cluster">
                <IconButton
                  label={t().child}
                  icon={GitBranch}
                  onClick={addSelectedChild}
                />
                <IconButton
                  label={t().sibling}
                  icon={Plus}
                  onClick={addSelectedSibling}
                />
                <IconButton
                  label={t().renameNode}
                  icon={Pencil}
                  onClick={requestRenameNode}
                />
                <IconButton
                  label={t().collapse}
                  icon={ChevronDown}
                  disabled={!hasChildren(map(), selected().id)}
                  onClick={() => toggleSubtree(selectedNodeID)}
                />
                <IconButton
                  label={t().remove}
                  icon={Trash}
                  disabled={selected().parent_id === null}
                  onClick={requestDeleteNode}
                />
              </div>
              <div class="command-cluster">
                <IconButton
                  label={
                    map().layout === "bilateral"
                      ? t().switchToRight
                      : t().switchToBilateral
                  }
                  icon={ArrowRightLeft}
                  onClick={() =>
                    setLayout(
                      currentDocument().layout === "bilateral"
                        ? "right"
                        : "bilateral",
                    )
                  }
                />
                <IconButton
                  label={t().center}
                  icon={Maximize}
                  onClick={() => centerMap()}
                />
                <Dropdown
                  align="end"
                  triggerAriaLabel={t().exportLabel}
                  trigger={<Download size={17} />}
                  items={() =>
                    EXPORT_FORMATS.map((format) => ({
                      id: format,
                      label: exportFormatLabel(format),
                    }))
                  }
                  onSelect={(format) => void exportCurrentMap(format)}
                  disabled={observe(() => exportBusy)()}
                />
              </div>
            </nav>
          </header>
          <div class="canvas-bottom">
            <span
              class="save-pill"
              classList={{
                "is-error": observe(
                  () => saveState === "error" || saveState === "conflict",
                )(),
              }}
              role="status"
            >
              {observe(saveLabel)()}
            </span>
            <div class="zoom-controls" data-floe-surface="floating">
              <IconButton
                label={t().zoomOut}
                icon={Minus}
                onClick={() => setZoom(viewport.zoom / 1.16)}
              />
              <span>
                {observe(() => Math.round(viewport.zoom * 100) + "%")()}
              </span>
              <IconButton
                label={t().zoomIn}
                icon={Plus}
                onClick={() => setZoom(viewport.zoom * 1.16)}
              />
            </div>
          </div>
          <div
            class="color-panel"
            data-floe-surface="floating"
            aria-label={t().nodeStyle}
          >
            <div class="color-control" role="group" aria-label={t().colors}>
              <For each={NODE_COLORS}>
                {(color) => (
                  <button
                    class={"color-button color-" + color}
                    type="button"
                    title={colorLabel(color)}
                    aria-label={colorLabel(color)}
                    aria-pressed={selected().color === color}
                    onClick={() => setSelectedColor(color)}
                  />
                )}
              </For>
            </div>
            <div
              class="alignment-control"
              role="group"
              aria-label={t().textAlignment}
            >
              <For each={NODE_ALIGNMENTS}>
                {(alignment) => (
                  <button
                    class="alignment-button"
                    type="button"
                    title={alignmentLabel(alignment)}
                    aria-label={alignmentLabel(alignment)}
                    aria-pressed={selected().alignment === alignment}
                    onClick={() => setSelectedAlignment(alignment)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <path
                        d={
                          "M2 4h12M" +
                          (alignment === "left"
                            ? 2
                            : alignment === "right"
                              ? 6
                              : 4) +
                          " 8h8M2 12h12"
                        }
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                      />
                    </svg>
                  </button>
                )}
              </For>
            </div>
          </div>
          <Show when={observe(() => nodeTitleEditor?.nodeID)()} keyed>
            {(id) => <NodeEditor nodeID={id} />}
          </Show>
          <Show when={observe(() => nodeContextMenu)()} keyed>
            {(menu) => <NodeMenu menu={menu} />}
          </Show>
          <Show
            when={observe(
              () => saveState === "conflict" || saveState === "error",
            )()}
          >
            <div class="notice-banner is-error" role="alert">
              <span>
                {observe(() =>
                  saveState === "conflict"
                    ? text().conflict
                    : saveMessage || text().saveFailed,
                )()}
              </span>
              <Show
                when={observe(() => saveState === "conflict")()}
                fallback={
                  <Button variant="ghost" onClick={() => void flushSave()}>
                    {t().retry}
                  </Button>
                }
              >
                <Button variant="ghost" onClick={() => void reloadLatest()}>
                  {t().reload}
                </Button>
                <Button variant="ghost" onClick={() => void recoverLocalCopy()}>
                  {t().recover}
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={observe(() => exportMessage)()}>
            <div class="notice-banner is-error" role="alert">
              <span>{observe(() => exportMessage)()}</span>
              <Button variant="ghost" onClick={dismissExportError}>
                {t().dismiss}
              </Button>
            </div>
          </Show>
        </div>
      </section>
      <Show when={observe(() => loadState !== "ready")()}>
        <div
          class="startup-overlay"
          role={observe(() => (loadState === "error" ? "alert" : "status"))()}
        >
          <div class="startup-content">
            <strong>
              {observe(() =>
                loadState === "error" ? text().loadFailedTitle : text().loading,
              )()}
            </strong>
            <Show when={observe(() => loadState === "error")()}>
              <p>{observe(() => loadMessage || text().loadFailed)()}</p>
              <Button onClick={() => void retryInitialLoad()}>
                {t().retry}
              </Button>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={observe(() => modal)()} keyed>
        {(current) => <EditorDialog current={current} />}
      </Show>
    </main>
  );
}
function alignmentLabel(v: NodeAlignment): string {
  return v === "left"
    ? text().alignLeft
    : v === "right"
      ? text().alignRight
      : text().alignCenter;
}
function NodeEditor(props: { nodeID: string }) {
  let input!: HTMLTextAreaElement;
  const placement = observe(() =>
      nodeEditorPlacement(
        currentLayout().nodes.get(props.nodeID)!,
        viewport,
        cssWidth,
        cssHeight,
      ),
    ),
    node = observe(
      () => currentDocument().nodes.find((n) => n.id === props.nodeID)!,
    );
  onMount(() => {
    input.focus();
    input.select();
  });
  return (
    <div
      class={
        "node-title-editor " +
        (currentLayout().nodes.get(props.nodeID)!.depth === 0
          ? "is-root"
          : currentLayout().nodes.get(props.nodeID)!.depth === 1
            ? "is-branch"
            : "is-topic") +
        " color-" +
        node().color +
        " alignment-" +
        node().alignment
      }
      style={{
        left: placement().centerX + "px",
        top: placement().centerY + "px",
        width: placement().width + "px",
        height: placement().height + "px",
        "--node-editor-zoom": String(placement().zoom),
      }}
    >
      <textarea
        ref={input}
        name="topic"
        aria-label={observe(() => text().topic)()}
        value={observe(() => nodeTitleEditor?.draft ?? "")()}
        maxLength={MAX_TITLE_UTF8_BYTES}
        onInput={(e) => updateNodeTitleEdit(e.currentTarget.value)}
        onCompositionStart={() => {
          if (nodeTitleEditor) nodeTitleEditor.isComposing = true;
        }}
        onCompositionEnd={(e) => {
          if (nodeTitleEditor) nodeTitleEditor.isComposing = false;
          updateNodeTitleEdit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.isComposing || nodeTitleEditor?.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelNodeTitleEdit();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commitNodeTitleEdit();
          }
        }}
        onBlur={() => commitNodeTitleEdit()}
      />
    </div>
  );
}
function EditorDialog(props: { current: Modal }) {
  const t = observe(text),
    details = observe(() => modalDetails(props.current)),
    isDelete = () =>
      props.current.kind === "delete-document" ||
      props.current.kind === "delete-node";
  let value =
    props.current.kind === "import" ? props.current.text : props.current.title;
  return (
    <Dialog
      open={observe(() => modal === props.current)()}
      title={details().title}
      closeLabel={t().cancel}
      onOpenChange={(open) => {
        if (!open) closeModal();
      }}
      escapeKeyPhase="bubble"
      class="mind-map-dialog"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitModal(value);
        }}
      >
        <Show when={isDelete()}>
          <p>{details().body}</p>
        </Show>
        <Show when={!isDelete()}>
          <Show
            when={props.current.kind === "import"}
            fallback={
              <Input
                autofocus
                aria-label={details().label}
                value={value}
                maxLength={80}
                onInput={(e) => {
                  value = e.currentTarget.value;
                }}
              />
            }
          >
            <input
              type="file"
              accept=".mindmap,.json,.txt"
              aria-label={t().importLabel}
              onChange={async (e) => {
                const input = e.currentTarget,
                  file = input.files?.[0];
                if (!file) return;
                if (file.size > MAX_IMPORT_BYTES) {
                  modalError = text().invalidImport;
                  void render();
                  return;
                }
                value = await file.text();
                const area = input.form?.querySelector("textarea");
                if (area) area.value = value;
              }}
            />
            <textarea
              class="dsl-input"
              name="dsl"
              aria-label={details().label}
              value={value}
              maxLength={MAX_IMPORT_BYTES}
              onInput={(e) => {
                value = e.currentTarget.value;
              }}
            />
          </Show>
        </Show>
        <Show when={observe(() => modalError)()}>
          <p class="dialog-error" role="alert">
            {observe(() => modalError)()}
          </p>
        </Show>
        <footer class="dialog-actions">
          <Button variant="outline" type="button" onClick={closeModal}>
            {t().cancel}
          </Button>
          <Button type="submit">{details().action}</Button>
        </footer>
      </form>
    </Dialog>
  );
}
function NodeMenu(props: { menu: NodeContextMenu }) {
  let menu!: HTMLDivElement;
  const close = () => {
    nodeContextMenu = undefined;
    void render();
    canvasElement.focus();
  };
  onMount(() =>
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(),
  );
  const activate = (i: number) => {
    close();
    if (i === 0) addSelectedChild();
    else if (i === 1) addSelectedSibling();
    else if (i === 2) requestRenameNode();
    else if (i === 3) toggleSubtree(selectedNodeID);
    else if (i === 4) requestDeleteNode();
  };
  return (
    <div
      ref={menu}
      class="node-context-menu"
      data-floe-surface="floating"
      role="menu"
      aria-label={text().nodeActions}
      style={{ left: props.menu.x + "px", top: props.menu.y + "px" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = Array.from(
              menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
            ),
            i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
          ]?.focus();
        }
      }}
      onFocusOut={(e) => {
        if (!menu.contains(e.relatedTarget as Node)) close();
      }}
    >
      <For each={nodeContextMenuItems()}>
        {(item, i) => (
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => activate(i())}
          >
            <span>{item.label}</span>
            <kbd>{item.shortcut}</kbd>
          </button>
        )}
      </For>
      <div class="context-colors">
        <For each={NODE_COLORS}>
          {(color) => (
            <button
              role="menuitem"
              class={"color-button color-" + color}
              aria-label={colorLabel(color)}
              title={colorLabel(color)}
              onClick={() => {
                close();
                setSelectedColor(color);
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function modalDetails(current: Modal): {
  title: string;
  body: string;
  label: string;
  action: string;
} {
  const t = text();
  switch (current.kind) {
    case "new-document":
      return {
        title: t.newTitle,
        body: "",
        label: t.mapName,
        action: t.create,
      };
    case "rename-document":
      return { title: t.renameMap, body: "", label: t.mapName, action: t.save };
    case "delete-document":
      return {
        title: t.deleteMapTitle,
        body: t.deleteMapBody,
        label: "",
        action: t.confirmDelete,
      };
    case "delete-node":
      return {
        title: t.deleteNodeTitle,
        body: `${t.deleteNodeBody} (${current.count})`,
        label: "",
        action: t.confirmDelete,
      };
    case "import":
      return {
        title: t.importTitle,
        body: t.importBody,
        label: t.importTitle,
        action: t.importAction,
      };
  }
}

function submitModal(value: string): void {
  if (!modal) return;
  value = value.trim();
  modalError = "";
  let accepted = false;
  try {
    if (modal.kind === "new-document") {
      accepted = runMutation(
        (draft) => addDocument(draft, value || undefined).nodes[0].id,
        true,
      );
    } else if (modal.kind === "rename-document") {
      accepted = runMutation((draft) =>
        renameDocument(selectedDocument(draft), value)
          ? selectedNodeID
          : undefined,
      );
    } else if (modal.kind === "delete-document") {
      accepted = runMutation((draft) => {
        deleteDocument(draft, draft.selected_document_id);
        return selectedDocument(draft).nodes[0].id;
      }, true);
    } else if (modal.kind === "delete-node") {
      const node = currentDocument().nodes.find(
        (candidate) => candidate.id === selectedNodeID,
      );
      const parentID = node?.parent_id;
      accepted = runMutation((draft) => {
        if (!parentID || !deleteNode(selectedDocument(draft), selectedNodeID))
          return undefined;
        return parentID;
      });
    } else if (modal.kind === "import") {
      accepted = runMutation(
        (draft) => importDocument(value, draft).nodes[0].id,
        true,
      );
    }
    if (accepted) modal = undefined;
    else
      modalError =
        modal.kind === "import" ? text().invalidImport : text().operationFailed;
  } catch {
    modalError = text().invalidImport;
  }
  void render();
  draw();
}

function openModal(next: Modal): void {
  if (loadState !== "ready") return;
  commitNodeTitleEdit();
  modalError = "";
  modal = next;
  void render();
}

function closeModal(): void {
  modal = undefined;
  void render();
  draw();
}

function dismissExportError(): void {
  exportMessage = "";
  void render();
}

async function exportCurrentMap(value: string): Promise<void> {
  if (
    loadState !== "ready" ||
    exportBusy ||
    !EXPORT_FORMATS.includes(value as ExportFormat)
  )
    return;
  const format = value as ExportFormat;
  exportBusy = true;
  exportMessage = "";
  commitNodeTitleEdit();
  void render();

  try {
    const document = currentDocument();
    const layout = layoutDocument(document, undefined, measureCanvasText);
    const baseName = safeExportBaseName(document.title);
    if (format === "dsl") {
      await bridge.exportFile({
        fileName: `${baseName}.mindmap`,
        mediaType: "text/plain",
        bytes: new TextEncoder().encode(serializeDocumentDSL(document)),
      });
    } else if (format === "svg") {
      await bridge.exportFile({
        fileName: `${baseName}.svg`,
        mediaType: "image/svg+xml",
        bytes: new TextEncoder().encode(
          serializeMindMapSVG(document, layout, colors),
        ),
      });
    } else {
      const mediaType =
        format === "png"
          ? "image/png"
          : format === "jpeg"
            ? "image/jpeg"
            : "image/webp";
      const blob = await renderBitmapExport(layout, mediaType);
      await bridge.exportFile({
        fileName: `${baseName}.${format === "jpeg" ? "jpg" : format}`,
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
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): Promise<Blob> {
  const bounds = exportLayoutBounds(layout);
  const size = bitmapExportSize(bounds);
  if (!canvas || !context) throw new Error("2D export canvas is unavailable");
  const targetCanvas = document.createElement("canvas");
  const originalWidth = targetCanvas.width;
  const originalHeight = targetCanvas.height;

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
    targetCanvas.width = size.width;
    targetCanvas.height = size.height;
    const targetContext = targetCanvas.getContext("2d", { alpha: false });
    if (!targetContext) throw new Error("2D export canvas is unavailable");
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
    selectedNodeID = "";
    nodeTitleEditor = undefined;
    pointer = undefined;
    dropTarget = undefined;
    nodeContextMenu = undefined;
    exportRendering = true;
    draw();
    return new Promise<Blob>((resolve, reject) =>
      targetCanvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Image export failed")),
        mediaType,
        0.92,
      ),
    );
  } finally {
    targetCanvas.width = originalWidth;
    targetCanvas.height = originalHeight;
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
    draw();
  }
}

async function selectMap(id: string): Promise<void> {
  if (loadState !== "ready") return;
  if (
    !workspace.documents.some((document) => document.id === id) ||
    id === workspace.selected_document_id
  )
    return;
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
  openModal({ kind: "delete-document", title: currentDocument().title });
}

function requestDeleteNode(): void {
  const node = currentDocument().nodes.find(
    (candidate) => candidate.id === selectedNodeID,
  );
  if (!node || node.parent_id === null) {
    saveMessage = text().rootCannotDelete;
    saveState = "error";
    void render();
    return;
  }
  const count = nodeAndDescendantCount(currentDocument(), selectedNodeID);
  if (count > 1) openModal({ kind: "delete-node", title: node.title, count });
  else
    runMutation((draft) => {
      const selected = selectedDocument(draft).nodes.find(
        (candidate) => candidate.id === selectedNodeID,
      );
      const parentID = selected?.parent_id;
      if (!parentID || !deleteNode(selectedDocument(draft), selectedNodeID))
        return undefined;
      return parentID;
    });
}

function requestRenameNode(): void {
  beginNodeTitleEdit(selectedNodeID);
}

function addSelectedChild(): void {
  let createdID = "";
  runMutation((draft) => {
    createdID = addChild(selectedDocument(draft), selectedNodeID).id;
    return createdID;
  });
  if (createdID) beginNodeTitleEdit(createdID, true);
}

function addSelectedSibling(): void {
  let createdID = "";
  runMutation((draft) => {
    createdID = addSibling(selectedDocument(draft), selectedNodeID).id;
    return createdID;
  });
  if (createdID) beginNodeTitleEdit(createdID, true);
}

function beginNodeTitleEdit(nodeID: string, clear = false): void {
  if (loadState !== "ready" || modal) return;
  const node = currentDocument().nodes.find(
    (candidate) => candidate.id === nodeID,
  );
  if (!node) return;
  selectedNodeID = node.id;
  pointer = undefined;
  dropTarget = undefined;
  nodeContextMenu = undefined;
  const before = currentLayout().nodes.get(node.id);
  nodeTitleEditor = {
    nodeID: node.id,
    draft: clear ? "" : node.title,
    isComposing: false,
  };
  const after = currentLayout().nodes.get(node.id);
  if (before && after)
    viewport = preserveNodeScreenPosition(viewport, before, after);
  revealSelection();
  void render();
  draw();
}

function updateNodeTitleEdit(value: string): void {
  if (!nodeTitleEditor || !isValidNodeTextDraft(value)) return;
  const before = currentLayout().nodes.get(nodeTitleEditor.nodeID);
  nodeTitleEditor.draft = value;
  const after = currentLayout().nodes.get(nodeTitleEditor.nodeID);
  if (before && after)
    viewport = preserveNodeScreenPosition(viewport, before, after);
  revealSelection();
  void render();
  draw();
}
function commitNodeTitleEdit(): void {
  const editor = nodeTitleEditor;
  if (!editor || editor.isComposing) return;
  nodeTitleEditor = undefined;
  runMutation((draft) =>
    renameNode(selectedDocument(draft), editor.nodeID, editor.draft)
      ? editor.nodeID
      : undefined,
  );
  void render();
  draw();
  canvasElement?.focus();
}
function cancelNodeTitleEdit(): void {
  if (!nodeTitleEditor || nodeTitleEditor.isComposing) return;
  const before = currentLayout().nodes.get(nodeTitleEditor.nodeID);
  const id = nodeTitleEditor.nodeID;
  nodeTitleEditor = undefined;
  const after = currentLayout().nodes.get(id);
  if (before && after)
    viewport = preserveNodeScreenPosition(viewport, before, after);
  void render();
  draw();
  canvasElement?.focus();
}

function toggleSubtree(nodeID: string): void {
  if (nodeTitleEditor?.isComposing) return;
  commitNodeTitleEdit();
  runMutation(
    (draft) =>
      toggleCollapsed(selectedDocument(draft), nodeID) ? nodeID : undefined,
    false,
    nodeID,
  );
}

function setLayout(layout: MindMapDocument["layout"]): void {
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
  runMutation((draft) =>
    setNodeColor(selectedDocument(draft), selectedNodeID, value as NodeColor)
      ? selectedNodeID
      : undefined,
  );
}

function setSelectedAlignment(value: string): void {
  if (!NODE_ALIGNMENTS.includes(value as NodeAlignment)) return;
  runMutation((draft) =>
    setNodeAlignment(selectedDocument(draft), selectedNodeID, value)
      ? selectedNodeID
      : undefined,
  );
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
): boolean {
  if (loadState !== "ready" || disposed) return false;
  nodeContextMenu = undefined;
  try {
    const anchorBefore = anchorNodeID
      ? currentLayout().nodes.get(anchorNodeID)
      : undefined;
    const draft = clone(workspace);
    const nextSelected = mutator(draft);
    validateWorkspace(draft);
    if (JSON.stringify(draft) === JSON.stringify(workspace)) return true;
    workspace = draft;
    history.commit(workspace);
    ensureSelection(nextSelected);
    const anchorAfter = anchorNodeID
      ? currentLayout().nodes.get(anchorNodeID)
      : undefined;
    if (anchorBefore && anchorAfter)
      viewport = preserveNodeScreenPosition(
        viewport,
        anchorBefore,
        anchorAfter,
      );
    revealSelection();
    markDirty(immediateSave);
    saveMessage = "";
    void render();
    draw();
    return true;
  } catch (error) {
    saveMessage =
      error instanceof Error ? error.message : text().operationFailed;
    saveState = "error";
    void render();
    return false;
  }
}

function undo(): void {
  if (loadState !== "ready") return;
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
  if (loadState !== "ready") return;
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
    : document.nodes.some((node) => node.id === selectedNodeID)
      ? selectedNodeID
      : document.nodes[0].id;
}

function markDirty(immediate: boolean): void {
  if (loadState !== "ready") return;
  dirty = true;
  editVersion += 1;
  if (saveState !== "conflict") saveState = "dirty";
  clearSaveTimer();
  if (immediate) void flushSave();
  else
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void flushSave();
    }, 400);
}

async function flushSave(): Promise<void> {
  clearSaveTimer();
  if (loadState !== "ready" || disposed) return;
  if (saveInFlight) await saveInFlight;
  if (pendingSave && !(await reconcileSave())) return;
  while (!disposed && dirty && saveState !== "conflict") {
    const saved = await saveOnce();
    if (!saved) break;
  }
}

async function saveOnce(): Promise<boolean> {
  if (saveInFlight) return saveInFlight;
  const snapshot = clone(workspace);
  const snapshotVersion = editVersion;
  const expectedRevision = revision;
  const workspaceDSL = serializeWorkspaceDSL(snapshot);
  saveState = "saving";
  void render();
  saveInFlight = (async () => {
    try {
      const response = await bridge.call<PluginMethodResult<SaveResponse>>(
        "mindmap.workspace.save",
        {
          expected_revision: expectedRevision,
          workspace_dsl: workspaceDSL,
        },
      );
      if (disposed) return false;
      revision = response.data.revision;
      savedAt = response.data.saved_at;
      if (editVersion === snapshotVersion) dirty = false;
      saveState = dirty ? "dirty" : "saved";
      saveMessage = "";
      return true;
    } catch (error) {
      if (disposed) return false;
      if (
        error instanceof PluginBridgeError &&
        error.errorCode === "PLUGIN_WORKER_ERROR" &&
        (error.details as { worker_error_code?: string } | undefined)
          ?.worker_error_code === "MIND_MAP_CONFLICT"
      ) {
        saveState = "conflict";
        saveMessage = text().conflict;
      } else {
        saveState = "error";
        saveMessage = text().saveFailed;
        if (
          !(error instanceof PluginBridgeError) ||
          error.mutationOutcome !== "not_committed"
        ) {
          pendingSave = {
            revision: expectedRevision,
            workspace_dsl: workspaceDSL,
            editVersion: snapshotVersion,
          };
        }
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

async function reconcileSave(): Promise<boolean> {
  const pending = pendingSave;
  if (!pending) return true;
  try {
    const response = await bridge.call<PluginMethodResult<LoadResponse>>(
      "mindmap.workspace.load",
      {},
    );
    if (disposed) return false;
    const outcome = reconcilePendingSave(pending, response.data);
    if (outcome === "committed") {
      revision = response.data.revision;
      savedAt = response.data.saved_at;
      if (editVersion === pending.editVersion) dirty = false;
      pendingSave = undefined;
      saveState = dirty ? "dirty" : "saved";
      saveMessage = "";
      void render();
      return true;
    }
    saveState = outcome === "conflict" ? "conflict" : "error";
    saveMessage = outcome === "conflict" ? text().conflict : text().saveFailed;
  } catch {
    saveState = "error";
    saveMessage = text().saveFailed;
  }
  void render();
  return false;
}

async function registerApplicationMethods(): Promise<void> {
  await bridge.registerMethod(
    "mindmap.document.read",
    (_params, { signal }) => {
      signal.throwIfAborted();
      return {
        document_id: workspace.selected_document_id,
        revision: editVersion,
        selected_node_id: selectedNodeID,
        document_dsl: serializeDocumentDSL(currentDocument()),
        dirty,
      };
    },
  );
  await bridge.registerMethod("mindmap.document.edit", (params, { signal }) => {
    signal.throwIfAborted();
    if (
      loadState !== "ready" ||
      disposed ||
      nodeTitleEditor ||
      modal ||
      pendingSave ||
      saveState === "conflict"
    )
      return { status: "busy", revision: editVersion };
    const result = prepareDocumentEdit(
      workspace,
      editVersion,
      params as unknown as DocumentEdit,
    );
    if (result.status !== "applied")
      return { status: result.status, revision: editVersion };
    const applied = runMutation((draft) => {
      draft.documents = result.workspace.documents;
      return result.selectedNodeID;
    });
    return { status: applied ? "applied" : "invalid", revision: editVersion };
  });
}

async function loadWorkspaceAtStartup(): Promise<boolean> {
  clearLoadRetryWait();
  loadState = "loading";
  loadMessage = "";
  saveState = "idle";
  await render();
  let response: PluginMethodResult<LoadResponse>;
  try {
    response = await loadWithRetry(
      () =>
        bridge.call<PluginMethodResult<LoadResponse>>(
          "mindmap.workspace.load",
          {},
        ),
      waitForLoadRetry,
    );
  } catch {
    if (surfaceDisposing || disposed) return false;
    loadState = "error";
    loadMessage = text().loadFailed;
    await render();
    draw();
    return false;
  }
  if (disposed) return false;
  try {
    parseWorkspaceDSL(response.data.workspace_dsl);
  } catch {
    loadState = "error";
    loadMessage = text().loadFailed;
    await render();
    draw();
    return false;
  }
  applyLoadedWorkspace(response.data);
  loadState = "ready";
  saveState = savedAt ? "saved" : "idle";
  await render();
  draw();
  return true;
}

async function retryInitialLoad(): Promise<void> {
  if (loadState === "loading" || surfaceDisposing || disposed) return;
  if (await loadWorkspaceAtStartup()) await activateLoadedWorkspace();
}

function applyLoadedWorkspace(response: LoadResponse): void {
  workspace = parseWorkspaceDSL(response.workspace_dsl);
  pendingSave = undefined;
  editVersion += 1;
  revision = response.revision;
  savedAt = response.saved_at;
  history = createHistory(workspace);
  selectedNodeID = selectedDocument(workspace).nodes[0].id;
  dirty = false;
  saveMessage = "";
  modal = undefined;
  nodeTitleEditor = undefined;
  centerMap(false);
}

async function reloadLatest(): Promise<void> {
  if (loadState !== "ready") return;
  try {
    const response = await bridge.call<PluginMethodResult<LoadResponse>>(
      "mindmap.workspace.load",
      {},
    );
    if (disposed) return;
    parseWorkspaceDSL(response.data.workspace_dsl);
    applyLoadedWorkspace(response.data);
    saveState = "saved";
  } catch (error) {
    saveState = "error";
    saveMessage =
      error instanceof Error ? error.message : text().operationFailed;
  }
  await render();
  draw();
}

async function recoverLocalCopy(): Promise<void> {
  if (loadState !== "ready") return;
  const localDocument = clone(currentDocument());
  try {
    const response = await bridge.call<PluginMethodResult<LoadResponse>>(
      "mindmap.workspace.load",
      {},
    );
    if (disposed) return;
    const remote = parseWorkspaceDSL(response.data.workspace_dsl);
    const recovered = importDocument(
      serializeDocumentDSL(localDocument),
      remote,
      Date.now(),
    );
    renameDocument(recovered, `${localDocument.title} — ${text().recovered}`);
    pendingSave = undefined;
    workspace = remote;
    revision = response.data.revision;
    savedAt = response.data.saved_at;
    history = createHistory(workspace);
    selectedNodeID = recovered.nodes[0].id;
    saveState = "dirty";
    saveMessage = "";
    dirty = true;
    editVersion += 1;
    await render();
    draw();
    await flushSave();
  } catch (error) {
    saveState = "error";
    saveMessage =
      error instanceof Error ? error.message : text().operationFailed;
    await render();
  }
}

function nativePointer(event: PointerEvent): void {
  if (loadState !== "ready" || modal) return;
  const bounds = canvasElement.getBoundingClientRect();
  if (event.type === "pointerdown") {
    event.preventDefault();
    canvasElement.focus();
    canvasElement.setPointerCapture(event.pointerId);
  }
  handlePointer({
    event: event.type,
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    pointerId: event.pointerId,
    button: event.button,
  });
  if (
    (event.type === "pointerup" || event.type === "pointercancel") &&
    canvasElement.hasPointerCapture(event.pointerId)
  )
    canvasElement.releasePointerCapture(event.pointerId);
}
function nativeWheel(event: WheelEvent): void {
  if (loadState !== "ready" || modal) return;
  event.preventDefault();
  const bounds = canvasElement.getBoundingClientRect();
  nodeContextMenu = undefined;
  setZoom(
    wheelZoomTarget(viewport.zoom, event.deltaY, event.deltaMode, cssHeight),
    event.clientX - bounds.left,
    event.clientY - bounds.top,
    false,
  );
}
function nativeKey(event: KeyboardEvent): void {
  if (loadState !== "ready" || modal || event.repeat || event.isComposing)
    return;
  if (
    [
      "Tab",
      "Enter",
      "F2",
      "Delete",
      "Backspace",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
    ].includes(event.code) ||
    ((event.metaKey || event.ctrlKey) &&
      ["KeyZ", "Equal", "Minus", "Digit0"].includes(event.code))
  )
    event.preventDefault();
  handleKey(event);
}

function handleKey(event: KeyboardEvent): void {
  if (event.code === "Escape" && nodeContextMenu) {
    nodeContextMenu = undefined;
    draw();
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  if (command && event.code === "KeyZ") {
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && (event.code === "Equal" || event.key === "+")) {
    setZoom(viewport.zoom * 1.16);
    return;
  }
  if (command && (event.code === "Minus" || event.key === "-")) {
    setZoom(viewport.zoom / 1.16);
    return;
  }
  if (command && event.code === "Digit0") {
    centerMap();
    return;
  }
  if (event.altKey || command) return;
  if (event.code === "Tab") addSelectedChild();
  else if (event.code === "Enter") addSelectedSibling();
  else if (event.code === "F2") requestRenameNode();
  else if (event.code === "Delete" || event.code === "Backspace")
    requestDeleteNode();
  else if (event.code.startsWith("Arrow")) selectDirectional(event.code);
}

function handlePointer(event: {
  event: string;
  x: number;
  y: number;
  pointerId: number;
  button: number;
}): void {
  const world = screenToWorld(event.x, event.y);
  if (event.event === "pointerdown") {
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
        nodeContextMenu = {
          nodeID: hit.id,
          ...placeContextMenu(event.x, event.y, cssWidth, cssHeight),
          hover: -1,
        };
        void render();
      }
      draw();
      return;
    }
    if (event.button !== 0) return;
    if (nodeContextMenu) {
      nodeContextMenu = undefined;
    }
    const expander = hitExpander(world.x, world.y);
    if (expander) {
      pointer = undefined;
      dropTarget = undefined;
      selectedNodeID = expander.id;
      lastClick = { nodeID: "", time: 0 };
      toggleSubtree(expander.id);
      return;
    }
    const hit = hitNode(world.x, world.y);
    if (hit) {
      selectedNodeID = hit.id;
      pointer = {
        pointerID: event.pointerId,
        kind: "node",
        nodeID: hit.id,
        startX: event.x,
        startY: event.y,
        startPanX: viewport.x,
        startPanY: viewport.y,
        moved: false,
        startWorldX: world.x,
        startWorldY: world.y,
        currentWorldX: world.x,
        currentWorldY: world.y,
      };
      void render();
      draw();
    } else {
      pointer = {
        pointerID: event.pointerId,
        kind: "pan",
        startX: event.x,
        startY: event.y,
        startPanX: viewport.x,
        startPanY: viewport.y,
        moved: false,
      };
    }
    return;
  }
  if (!pointer || pointer.pointerID !== event.pointerId) return;
  if (event.event === "pointermove") {
    const distance = Math.hypot(
      event.x - pointer.startX,
      event.y - pointer.startY,
    );
    if (distance > 5) pointer.moved = true;
    if (pointer.kind === "node") {
      pointer.currentWorldX = world.x;
      pointer.currentWorldY = world.y;
    }
    if (pointer.kind === "pan") {
      viewport.x = pointer.startPanX + event.x - pointer.startX;
      viewport.y = pointer.startPanY + event.y - pointer.startY;
    } else if (pointer.moved && pointer.nodeID && !isRoot(pointer.nodeID)) {
      dropTarget = findDropTarget(pointer.nodeID, world.x, world.y);
    }
    draw();
    return;
  }
  if (event.event === "pointerup") {
    const finished = pointer;
    pointer = undefined;
    if (finished.kind === "node" && finished.nodeID) {
      if (finished.moved && dropTarget && !isRoot(finished.nodeID)) {
        const target = dropTarget;
        runMutation((draft) =>
          moveNode(
            selectedDocument(draft),
            finished.nodeID!,
            target.parentID,
            target.side,
            target.order,
          )
            ? finished.nodeID
            : undefined,
        );
      } else if (!finished.moved) {
        const now = performance.now();
        if (lastClick.nodeID === finished.nodeID && now - lastClick.time < 360)
          requestRenameNode();
        lastClick = { nodeID: finished.nodeID, time: now };
      }
    }
    dropTarget = undefined;
    void render();
    draw();
    return;
  }
  if (event.event === "pointercancel") {
    pointer = undefined;
    dropTarget = undefined;
    draw();
  }
}

function nodeContextMenuItems(
  nodeID = nodeContextMenu?.nodeID ?? selectedNodeID,
): Array<{
  label: string;
  shortcut: string;
  disabled: boolean;
  danger?: boolean;
}> {
  const document = currentDocument();
  const node =
    document.nodes.find((candidate) => candidate.id === nodeID) ??
    document.nodes[0];
  const root = node.parent_id === null;
  const t = text();
  return [
    { label: t.child, shortcut: "Tab", disabled: false },
    { label: t.sibling, shortcut: "Enter", disabled: root },
    { label: t.rename, shortcut: "F2", disabled: false },
    {
      label: t.collapse,
      shortcut: "",
      disabled: !hasChildren(document, node.id),
    },
    { label: t.remove, shortcut: "⌫", disabled: root, danger: true },
  ];
}

function findDropTarget(
  draggedID: string,
  x: number,
  y: number,
): DropTarget | undefined {
  const document = currentDocument();
  const targetBox = hitNode(x, y, draggedID);
  if (!targetBox) return undefined;
  const target = document.nodes.find((node) => node.id === targetBox.id);
  if (
    !target ||
    target.id === draggedID ||
    isWithinBranch(document, target.id, draggedID)
  )
    return undefined;
  const t = text();
  if (
    target.parent_id !== null &&
    Math.abs(y - targetBox.y) > targetBox.height * 0.27
  ) {
    const siblings = document.nodes
      .filter(
        (node) => node.parent_id === target.parent_id && node.id !== draggedID,
      )
      .sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((node) => node.id === target.id);
    const after = y > targetBox.y;
    return {
      parentID: target.parent_id,
      order: Math.max(0, index + (after ? 1 : 0)),
      side: target.side,
      label: after ? t.dropAfter : t.dropBefore,
    };
  }
  const childCount = document.nodes.filter(
    (node) => node.parent_id === target.id && node.id !== draggedID,
  ).length;
  const side =
    target.parent_id === null
      ? x < targetBox.x
        ? "left"
        : "right"
      : target.side;
  return { parentID: target.id, order: childCount, side, label: t.dropInside };
}

function selectDirectional(code: string): void {
  const layout = currentLayout();
  const current = layout.nodes.get(selectedNodeID);
  if (!current) return;
  const direction =
    code === "ArrowLeft"
      ? { x: -1, y: 0 }
      : code === "ArrowRight"
        ? { x: 1, y: 0 }
        : code === "ArrowUp"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
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
  if (loadState !== "ready") return;
  context.save();
  context.translate(cssWidth / 2 + viewport.x, cssHeight / 2 + viewport.y);
  context.scale(viewport.zoom, viewport.zoom);
  const layout = currentLayout();
  drawEdges(layout);
  drawNodes(layout);
  if (!exportRendering && currentDocument().nodes.length === 1)
    drawFirstBranchHint(layout);
  context.restore();
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
  const glow = context.createRadialGradient(
    cssWidth * 0.54,
    cssHeight * 0.42,
    0,
    cssWidth * 0.54,
    cssHeight * 0.42,
    glowRadius,
  );
  glow.addColorStop(0, withAlpha(colors.accent, 0.045));
  glow.addColorStop(1, withAlpha(colors.accent, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, cssWidth, cssHeight);
}

function drawGrid(): void {
  if (!context) return;
  const gap = Math.max(22, 32 * viewport.zoom);
  const offsetX = (((cssWidth / 2 + viewport.x) % gap) + gap) % gap;
  const offsetY = (((cssHeight / 2 + viewport.y) % gap) + gap) % gap;
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
  context.lineCap = "round";
  for (const edge of layout.edges) {
    const from = layout.nodes.get(edge.from);
    const to = layout.nodes.get(edge.to);
    const fromNode = document.nodes.find((node) => node.id === edge.from);
    const toNode = document.nodes.find((node) => node.id === edge.to);
    if (!from || !to || !fromNode || !toNode) continue;
    const start = edgeAnchor(from, edge.side, "source");
    const end = edgeAnchor(to, edge.side, "target");
    const bend = Math.abs(end.x - start.x) * 0.48;
    const fromColor = nodeColor(fromNode.color);
    const toColor = nodeColor(toNode.color);
    const stroke = context.createLinearGradient(start.x, start.y, end.x, end.y);
    stroke.addColorStop(
      0,
      withAlpha(fromColor, from.depth === 0 ? 0.34 : 0.58),
    );
    stroke.addColorStop(1, withAlpha(toColor, to.depth <= 1 ? 0.88 : 0.72));
    context.lineWidth =
      (to.depth === 1 ? 2.6 : to.depth === 2 ? 1.8 : 1.45) / viewport.zoom;
    context.strokeStyle = stroke;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.bezierCurveTo(
      start.x + (edge.side === "right" ? bend : -bend),
      start.y,
      end.x - (edge.side === "right" ? bend : -bend),
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
    drawNodeAt(
      box,
      node,
      node.id === selectedNodeID && !isDragging,
      dropTarget?.parentID === node.id,
      isDragging ? 0.2 : 1,
    );
  }
  if (draggingID) drawDraggedNode(layout, document, draggingID);
  if (dropTarget && pointer?.kind === "node") drawDropLabel(layout);
}

function drawNodeAt(
  box: LayoutNode,
  node: MindMapNode,
  selected: boolean,
  isDropParent: boolean,
  opacity = 1,
): void {
  if (!context) return;
  context.save();
  context.globalAlpha = opacity;
  if (selected) drawSelectionHalo(box);
  const accent = nodeColor(node.color);
  if (box.depth >= 2) drawTopicNode(box, accent, selected, isDropParent);
  else drawBlockNode(box, node, accent, selected, isDropParent);

  if (nodeTitleEditor?.nodeID !== node.id) {
    context.fillStyle =
      box.depth === 0
        ? contrastText(accent)
        : box.depth === 1
          ? colors.text
          : mixColor(colors.text, accent, 0.22);
    context.font = box.text.font;
    const textAnchor = textLineAnchor(box, node.alignment);
    context.textAlign = textAnchor.textAlign;
    context.textBaseline = "middle";
    const firstLineY =
      box.y +
      (box.depth >= 2 ? -2 : 0) -
      ((box.text.lines.length - 1) * box.text.lineHeight) / 2;
    for (const [lineIndex, line] of box.text.lines.entries()) {
      context.fillText(
        line,
        textAnchor.x,
        firstLineY + lineIndex * box.text.lineHeight,
      );
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
    context.font = "700 10px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(node.collapsed ? "+" : "−", badge.x, badge.y + 0.5);
  }
  context.restore();
}

function activeDraggedNodeID(): string | undefined {
  if (
    !pointer ||
    pointer.kind !== "node" ||
    !pointer.moved ||
    !pointer.nodeID ||
    isRoot(pointer.nodeID)
  )
    return undefined;
  return pointer.nodeID;
}

function drawDraggedNode(
  layout: DocumentLayout,
  document: MindMapDocument,
  nodeID: string,
): void {
  if (
    !pointer ||
    pointer.startWorldX === undefined ||
    pointer.startWorldY === undefined ||
    pointer.currentWorldX === undefined ||
    pointer.currentWorldY === undefined
  )
    return;
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

function drawBlockNode(
  box: LayoutNode,
  node: MindMapNode,
  accent: string,
  selected: boolean,
  isDropParent: boolean,
): void {
  if (!context) return;
  context.shadowColor = selected
    ? withAlpha(colors.focus, 0.18)
    : withAlpha("#000000", box.depth === 0 ? 0.18 : 0.1);
  context.shadowBlur = box.depth === 0 ? 24 : selected ? 16 : 10;
  context.shadowOffsetY = box.depth === 0 ? 8 : 4;
  roundedRect(
    context,
    box.x - box.width / 2,
    box.y - box.height / 2,
    box.width,
    box.height,
    box.depth === 0 ? 14 : 11,
  );
  if (box.depth === 0) {
    const rootFill = context.createLinearGradient(
      box.x - box.width / 2,
      box.y - box.height / 2,
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    rootFill.addColorStop(0, mixColor(nodeColor(node.color), "#ffffff", 0.14));
    rootFill.addColorStop(1, mixColor(nodeColor(node.color), "#000000", 0.1));
    context.fillStyle = rootFill;
  } else {
    context.fillStyle = mixColor(colors.surface_elevated, accent, 0.13);
  }
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = (isDropParent ? 2.5 : 1) / viewport.zoom;
  context.strokeStyle = isDropParent
    ? colors.success
    : box.depth === 0
      ? withAlpha("#ffffff", 0.22)
      : withAlpha(accent, selected ? 0.62 : 0.26);
  context.stroke();

  if (box.depth === 1) {
    const railWidth = 3;
    const railX =
      box.side === "left"
        ? box.x + box.width / 2 - railWidth - 2
        : box.x - box.width / 2 + 2;
    const railHeight = Math.min(24, box.height - 14);
    roundedRect(
      context,
      railX,
      box.y - railHeight / 2,
      railWidth,
      railHeight,
      2,
    );
    context.fillStyle = accent;
    context.fill();
  }
}

function drawTopicNode(
  box: LayoutNode,
  accent: string,
  selected: boolean,
  isDropParent: boolean,
): void {
  if (!context) return;
  const underline = topicUnderline(box);
  if (isDropParent) {
    context.save();
    context.setLineDash([4 / viewport.zoom, 3 / viewport.zoom]);
    roundedRect(
      context,
      box.x - box.width / 2,
      box.y - box.height / 2,
      box.width,
      box.height,
      7,
    );
    context.lineWidth = 1.5 / viewport.zoom;
    context.strokeStyle = withAlpha(colors.success, 0.82);
    context.stroke();
    context.restore();
  }
  context.save();
  context.shadowColor = selected ? withAlpha(accent, 0.34) : "transparent";
  context.shadowBlur = selected ? 8 : 0;
  context.lineWidth =
    (isDropParent ? 2.8 : selected ? 2.4 : box.depth === 2 ? 2 : 1.6) /
    viewport.zoom;
  context.strokeStyle = isDropParent
    ? colors.success
    : withAlpha(accent, selected ? 0.96 : 0.78);
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
  roundedRect(
    context,
    box.x - box.width / 2 - 4,
    box.y - box.height / 2 - 4,
    box.width + 8,
    box.height + 8,
    box.depth === 0 ? 17 : box.depth === 1 ? 14 : 11,
  );
  context.lineWidth = (box.depth >= 2 ? 1.25 : 1.5) / viewport.zoom;
  if (box.depth >= 2)
    context.setLineDash([4 / viewport.zoom, 3 / viewport.zoom]);
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
  context.font = "600 11px system-ui, sans-serif";
  const width = context.measureText(label).width + 24;
  roundedRect(
    context,
    root.x - width / 2,
    root.y + root.height / 2 + 18,
    width,
    28,
    14,
  );
  context.fillStyle = withAlpha(colors.surface_elevated, 0.82);
  context.fill();
  context.fillStyle = colors.text_muted;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, root.x, root.y + root.height / 2 + 32);
  context.restore();
}

function drawDropLabel(layout: DocumentLayout): void {
  if (!context || !dropTarget) return;
  const parent = layout.nodes.get(dropTarget.parentID);
  if (!parent) return;
  context.save();
  context.font = "700 11px system-ui, sans-serif";
  const width = context.measureText(dropTarget.label).width + 18;
  roundedRect(
    context,
    parent.x - width / 2,
    parent.y + parent.height / 2 + 10,
    width,
    24,
    8,
  );
  context.fillStyle = colors.success;
  context.fill();
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    dropTarget.label,
    parent.x,
    parent.y + parent.height / 2 + 22,
  );
  context.restore();
}

function hitNode(
  x: number,
  y: number,
  excludedID?: string,
): LayoutNode | undefined {
  const nodes = [...currentLayout().nodes.values()].reverse();
  return nodes.find(
    (box) =>
      box.id !== excludedID &&
      x >= box.x - box.width / 2 &&
      x <= box.x + box.width / 2 &&
      y >= box.y - box.height / 2 &&
      y <= box.y + box.height / 2,
  );
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
  viewport = fitLayoutToViewport(
    currentLayout(),
    cssWidth,
    cssHeight,
    viewportPadding(),
  );
  draw();
  if (renderUI) void render();
}

function revealSelection(): void {
  let box = currentLayout().nodes.get(selectedNodeID);
  if (!box) return;
  const padding = viewportPadding();
  const availableWidth = Math.max(1, cssWidth - padding.left - padding.right);
  const availableHeight = Math.max(1, cssHeight - padding.top - padding.bottom);
  const fittingZoom = Math.min(
    viewport.zoom,
    availableWidth / box.width,
    availableHeight / box.height,
  );
  if (fittingZoom < viewport.zoom) {
    const anchorX = cssWidth / 2 + viewport.x + box.x * viewport.zoom;
    const anchorY = cssHeight / 2 + viewport.y + box.y * viewport.zoom;
    viewport = zoomViewportAtPoint(
      viewport,
      fittingZoom,
      anchorX,
      anchorY,
      cssWidth,
      cssHeight,
    );
    box = currentLayout().nodes.get(selectedNodeID) ?? box;
  }
  const left =
    cssWidth / 2 + viewport.x + (box.x - box.width / 2) * viewport.zoom;
  const right =
    cssWidth / 2 + viewport.x + (box.x + box.width / 2) * viewport.zoom;
  const top =
    cssHeight / 2 + viewport.y + (box.y - box.height / 2) * viewport.zoom;
  const bottom =
    cssHeight / 2 + viewport.y + (box.y + box.height / 2) * viewport.zoom;
  if (left < padding.left) viewport.x += padding.left - left;
  else if (right > cssWidth - padding.right)
    viewport.x -= right - (cssWidth - padding.right);
  if (top < padding.top) viewport.y += padding.top - top;
  else if (bottom > cssHeight - padding.bottom)
    viewport.y -= bottom - (cssHeight - padding.bottom);
}

function currentLayout(): DocumentLayout {
  const editing = nodeTitleEditor
    ? { nodeID: nodeTitleEditor.nodeID, title: nodeTitleEditor.draft }
    : undefined;
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
  return { top: cssWidth < 520 ? 126 : 92, right: 28, bottom: 114, left: 28 };
}

function setZoom(
  value: number,
  anchorX = cssWidth / 2,
  anchorY = cssHeight / 2,
  renderImmediately = true,
): void {
  if (loadState !== "ready") return;
  viewport = zoomViewportAtPoint(
    viewport,
    value,
    anchorX,
    anchorY,
    cssWidth,
    cssHeight,
  );
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
  return (
    currentDocument().nodes.find((node) => node.id === nodeID)?.parent_id ===
    null
  );
}

function isWithinBranch(
  document: MindMapDocument,
  nodeID: string,
  ancestorID: string,
): boolean {
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
  if (saveState === "saving") return t.saving;
  if (saveState === "dirty") return t.unsaved;
  if (saveState === "error") return t.saveFailed;
  if (saveState === "conflict") return t.conflict;
  if (saveState === "saved" && savedAt) return t.saved;
  return t.statusReady;
}

function render(): Promise<void> {
  if (!disposed) setViewVersion((value) => value + 1);
  return Promise.resolve();
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
  if (format === "png") return t.exportPNG;
  if (format === "jpeg") return t.exportJPEG;
  if (format === "webp") return t.exportWebP;
  if (format === "svg") return t.exportSVG;
  return t.exportDSL;
}

function colorLabel(color: NodeColor): string {
  const t = text();
  if (color === "accent") return t.colorAccent;
  if (color === "blue") return t.colorBlue;
  if (color === "green") return t.colorGreen;
  if (color === "amber") return t.colorAmber;
  if (color === "rose") return t.colorRose;
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
  const channel = (shift: number) =>
    Math.round(
      ((leftValue >> shift) & 255) * (1 - amount) +
        ((rightValue >> shift) & 255) * amount,
    );
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function contrastText(hex: string): string {
  const value = parseHexColor(hex);
  if (value === undefined) return colors.accent_text;
  const luminance =
    ((value >> 16) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) /
    1000;
  return luminance > 170 ? "#202532" : "#ffffff";
}

function roundedRect(
  target: DrawingContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
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
  if (value.length !== 7 || value[0] !== "#") return undefined;
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

const root = document.getElementById("app");
if (!root) throw new Error("Mind Map application root is missing");
const unmount = mount(
  () => (
    <FloeProvider
      config={{
        theme: {
          defaultTheme: "light",
          defaultSurfaceStyle: "soft-neumorphic",
        },
        storage: { namespace: "mind-map", enabled: false },
      }}
    >
      <MindMapApp />
    </FloeProvider>
  ),
  root,
);
