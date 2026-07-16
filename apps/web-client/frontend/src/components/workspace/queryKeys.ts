/** Workspace TanStack Query keys — shared so views invalidate consistently. */

export function workspaceGameKey(param: string): readonly unknown[] {
  return ["workspace-game", param];
}

export function workspaceChatKey(gameId: string): readonly unknown[] {
  return ["workspace-chat", gameId];
}

export function workspaceVersionsKey(gameId: string): readonly unknown[] {
  return ["workspace-versions", gameId];
}

export function workspaceFilesKey(gameId: string, versionId: string): readonly unknown[] {
  return ["workspace-files", gameId, versionId];
}

export function workspaceSourceKey(
  gameId: string,
  versionId: string,
  path = "index.html",
): readonly unknown[] {
  return ["workspace-source", gameId, versionId, path];
}

export function myGamesKey(): readonly unknown[] {
  return ["my-games"];
}

export function workspaceDraftKey(jobId: string): readonly unknown[] {
  return ["workspace-draft", jobId];
}
