/** A shareable page location; node selection never changes workflow progress. */
export type WorkflowRoute = { projectId: string; nodeCode?: string };
export function workflowPageHash(projectId: string, nodeCode?: string) {
  return `#workflow/${encodeURIComponent(projectId)}${nodeCode ? `/${encodeURIComponent(nodeCode)}` : ''}`;
}
export function parseWorkflowPageHash(hash: string): WorkflowRoute | null {
  const parts = hash.match(/^#workflow\/([^/]+)(?:\/([^/]+))?$/);
  if (!parts) return null;
  try {
    const projectId = decodeURIComponent(parts[1]);
    const nodeCode = parts[2] ? decodeURIComponent(parts[2]) : undefined;
    if (!projectId.trim() || (nodeCode !== undefined && !nodeCode.trim()))
      return null;
    return { projectId, ...(nodeCode ? { nodeCode } : {}) };
  } catch {
    return null;
  }
}
