// Entry: mounts the account hub (reference app/me/page.tsx) at /me.
// AccountScreen reads ?tab= itself via the next/navigation shim, so the
// /me?tab=saved deep link behaves exactly like the reference.
import { AccountScreen } from "@/components/account/AccountScreen";
import { mountIsland } from "./lib/mount";

mountIsland("account-island", () => <AccountScreen />);
