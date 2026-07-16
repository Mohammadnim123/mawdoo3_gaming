// Entry: mounts the workspace island into the studio page. Props are
// server-rendered as JSON (#workspace-props) so the island needs zero
// bootstrap requests — the session cookie carries auth.

import { createRoot } from "react-dom/client";

import { readMountProps, setCsrfToken } from "./lib/api";
import { WorkspaceIsland, type WorkspaceProps } from "./workspace/WorkspaceIsland";

const mount = document.getElementById("workspace-island");
const props = readMountProps<WorkspaceProps>("workspace-props");

if (mount && props) {
  setCsrfToken(props.csrfToken);
  createRoot(mount).render(<WorkspaceIsland {...props} />);
}
