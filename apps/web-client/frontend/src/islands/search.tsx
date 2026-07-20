// Entry: mounts the search results screen (reference app/search/page.tsx)
// at /search. SearchScreen seeds from ?q= and mirrors typing back into the
// URL (debounced, same-document) via the next/navigation shim.
import { SearchScreen } from "@/components/search/SearchScreen";
import { mountIsland } from "./lib/mount";

mountIsland("search-island", () => <SearchScreen />);
