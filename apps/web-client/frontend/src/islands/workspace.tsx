// Entry: the studio workspace island — the ONE island behind every studio
// URL shape (reference `app/studio/page.tsx` + `app/studio/[gameId]/page.tsx`):
//   /studio                → new-project workspace (StudioEntry)
//   /studio?job={id}       → /create handoff, captured ONCE (StudioEntry)
//   /studio/{gameId}       → existing project (server-rendered {gameId} prop)
// The screen self-rewrites the URL via history.replaceState as a job promotes
// (/studio?job= → /studio/{gameId}) WITHOUT remounting; Django renders the
// island props as JSON in <script id="workspace-island-props">.

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { WorkspaceScreen } from "@/components/workspace/WorkspaceScreen";
import { mountIsland } from "./lib/mount";

interface WorkspaceIslandProps {
  gameId?: string | null;
  jobId?: string | null;
}

/**
 * Mounts the new-project workspace. The `?job=` handoff is captured ONCE —
 * the workspace itself rewrites the URL as the job starts/publishes
 * (`history.replaceState`, which the navigation shim syncs into
 * `useSearchParams`), and those self-inflicted updates must NOT remount the
 * live screen. Only a real navigation back to a bare `/studio` ("New
 * project") starts a clean slate.
 */
function StudioEntry({ jobIdProp }: { jobIdProp: string | null }): ReactElement {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const jobParam = searchParams.get("job");
  const [initialJobId] = useState(jobParam ?? jobIdProp);
  const [epoch, setEpoch] = useState(0);
  const lastUrl = useRef({ pathname, jobParam });

  useEffect(() => {
    const prev = lastUrl.current;
    lastUrl.current = { pathname, jobParam };
    // URL moved BACK to a bare /studio after the workspace promoted itself
    // (→ /studio?job= → /studio/{gameId}): that's a "New project" navigation.
    if (
      pathname === "/studio" &&
      jobParam === null &&
      (prev.pathname !== "/studio" || prev.jobParam !== null)
    ) {
      setEpoch((e) => e + 1);
    }
  }, [pathname, jobParam]);

  return (
    <WorkspaceScreen
      key={epoch}
      gameIdParam={null}
      initialJobId={epoch === 0 ? initialJobId : null}
    />
  );
}

function WorkspaceIsland(props: WorkspaceIslandProps): ReactElement {
  const gameId = props.gameId ?? null;
  if (gameId !== null && gameId !== "") {
    // Existing-project workspace — owner-only (E14-F1); ownerGuard inside
    // WorkspaceScreen handles non-owner/not-found via the API.
    return <WorkspaceScreen key={gameId} gameIdParam={gameId} initialJobId={null} />;
  }
  return <StudioEntry jobIdProp={props.jobId ?? null} />;
}

mountIsland("workspace-island", (props: WorkspaceIslandProps) => <WorkspaceIsland {...props} />);
