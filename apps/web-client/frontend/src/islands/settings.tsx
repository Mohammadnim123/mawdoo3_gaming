// Entry: mounts the device-preferences screen (reference
// app/account/settings/page.tsx) at /account/settings. Theme persists via
// ThemeProvider (fp-theme storage key); language switches navigate to
// ?lang=xx so Django re-renders <html lang dir> with the fp_locale cookie.
import { SettingsScreen } from "@/components/account/SettingsScreen";
import { mountIsland } from "./lib/mount";

mountIsland("settings-island", () => <SettingsScreen />);
