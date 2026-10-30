export type SaveSnapshot = { revision: number; workspace_dsl: string };
export function reconcilePendingSave(
  sent: SaveSnapshot,
  current: SaveSnapshot,
): "committed" | "conflict" | "unknown" {
  if (
    current.revision === sent.revision + 1 &&
    current.workspace_dsl === sent.workspace_dsl
  )
    return "committed";
  if (current.revision > sent.revision) return "conflict";
  return "unknown";
}
