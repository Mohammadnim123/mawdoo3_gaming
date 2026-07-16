// Entry: mounts the creator dashboard (reference app/dashboard/page.tsx)
// at /dashboard — overview stats, per-game analytics and payouts tabs.
import { DashboardScreen } from "@/components/dashboard/DashboardScreen";
import { mountIsland } from "./lib/mount";

mountIsland("dashboard-island", () => <DashboardScreen />);
