export function toRuntimePaneId(workspaceId: string, paneId: string): string {
  return `${workspaceId}::${paneId}`;
}
