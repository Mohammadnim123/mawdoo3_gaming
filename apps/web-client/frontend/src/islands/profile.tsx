// Entry: mounts the public creator profile (reference app/u/[handle]/page.tsx)
// at /u/{handle}. The handle is the only server-rendered prop — the screen
// self-fetches the profile, games and the viewer's own library tabs.
import { ProfileScreen } from "@/components/profile/ProfileScreen";
import { mountIsland } from "./lib/mount";

interface ProfileIslandProps {
  handle?: string;
}

mountIsland("profile-island", (props: ProfileIslandProps) => (
  <ProfileScreen handle={props.handle ?? ""} />
));
