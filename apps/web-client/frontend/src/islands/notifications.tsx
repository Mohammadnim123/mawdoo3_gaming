// Entry: mounts the notifications inbox (reference app/notifications/page.tsx)
// at /notifications. The screen itself calls markNotificationsRead on mount
// (reference behavior) — unread rows stay highlighted for this render only.
import { NotificationsScreen } from "@/components/social/NotificationsScreen";
import { mountIsland } from "./lib/mount";

mountIsland("notifications-island", () => <NotificationsScreen />);
