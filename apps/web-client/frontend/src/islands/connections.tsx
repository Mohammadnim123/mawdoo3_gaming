// Entry: the Following/Followers page island, mounted at
// /u/{handle}/followers and /u/{handle}/following. The handle + initial tab
// are the only server props; the screen self-fetches the profile header and
// both people lists.
import { ConnectionsScreen } from "@/components/profile/ConnectionsScreen";
import { mountIsland } from "./lib/mount";

interface ConnectionsIslandProps {
  handle?: string;
  tab?: "followers" | "following";
}

mountIsland("connections-island", (props: ConnectionsIslandProps) => (
  <ConnectionsScreen handle={props.handle ?? ""} initialTab={props.tab ?? "followers"} />
));
