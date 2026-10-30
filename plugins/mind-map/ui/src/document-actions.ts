import {
  addChild,
  addSibling,
  deleteNode,
  moveNode,
  renameNode,
  setNodeAlignment,
  setNodeColor,
  toggleCollapsed,
  validateWorkspace,
  type MindMapWorkspace,
  type NodeAlignment,
  type NodeColor,
  type BranchSide,
} from "./workspace-model.ts";
export type DocumentOperation = {
  type: string;
  node_id: string;
  title?: string;
  parent_id?: string;
  order?: number;
  side?: BranchSide;
  color?: NodeColor;
  alignment?: NodeAlignment;
};
export type DocumentEdit = {
  document_id: string;
  expected_revision: number;
  operations: DocumentOperation[];
};
export type DocumentEditResult =
  | { status: "applied"; workspace: MindMapWorkspace; selectedNodeID: string }
  | { status: "conflict" | "wrong_document" | "invalid" };
export function prepareDocumentEdit(
  workspace: MindMapWorkspace,
  revision: number,
  request: DocumentEdit,
): DocumentEditResult {
  if (request.expected_revision !== revision) return { status: "conflict" };
  if (request.document_id !== workspace.selected_document_id)
    return { status: "wrong_document" };
  if (
    !Array.isArray(request.operations) ||
    request.operations.length < 1 ||
    request.operations.length > 100
  )
    return { status: "invalid" };
  const draft = structuredClone(workspace),
    document = draft.documents.find((item) => item.id === request.document_id)!;
  let selectedNodeID = document.nodes[0].id;
  try {
    for (const op of request.operations) {
      if (!document.nodes.some((node) => node.id === op.node_id))
        throw Error("Unknown node");
      selectedNodeID = op.node_id;
      switch (op.type) {
        case "rename_node":
          if (typeof op.title !== "string") throw Error("Title required");
          renameNode(document, op.node_id, op.title);
          break;
        case "add_child":
          selectedNodeID = addChild(document, op.node_id, op.title).id;
          break;
        case "add_sibling":
          selectedNodeID = addSibling(document, op.node_id, op.title).id;
          break;
        case "delete_node":
          if (!deleteNode(document, op.node_id))
            throw Error("Cannot delete root");
          selectedNodeID = document.nodes[0].id;
          break;
        case "move_node":
          if (
            !op.parent_id ||
            !moveNode(document, op.node_id, op.parent_id, op.side, op.order)
          )
            throw Error("Invalid move");
          break;
        case "set_color":
          if (
            !["accent", "blue", "green", "amber", "rose", "violet"].includes(
              op.color ?? "",
            )
          )
            throw Error("Invalid color");
          setNodeColor(document, op.node_id, op.color!);
          break;
        case "set_alignment":
          if (!["left", "center", "right"].includes(op.alignment ?? ""))
            throw Error("Invalid alignment");
          setNodeAlignment(document, op.node_id, op.alignment!);
          break;
        case "toggle_collapsed":
          toggleCollapsed(document, op.node_id);
          break;
        default:
          throw Error("Unknown operation");
      }
    }
    validateWorkspace(draft);
    return { status: "applied", workspace: draft, selectedNodeID };
  } catch {
    return { status: "invalid" };
  }
}
