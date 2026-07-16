// Entry: the /create island — compose → brief → quota phases; a successful
// generate hands off to the workspace (`router.push('/studio?job={id}')`).
// CreateFlow reads `?idea=` / legacy `?job=` deep links straight from the URL
// via the navigation shim; the server-rendered props stay informational.

import { CreateFlow } from "@/components/create/CreateFlow";
import { mountIsland } from "./lib/mount";

mountIsland("create-island", () => <CreateFlow />);
