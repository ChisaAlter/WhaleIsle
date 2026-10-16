// Browser-only build alias for @openuidev/lang-core. The direct relative import
// reaches the pinned original package without recursively resolving this alias.
import { createStore as createUpstreamStore } from "../../vendor/open-intelligent-ui/node_modules/@openuidev/lang-core/dist/index.mjs";
import { createPersistentStore } from "./state-store";
export * from "../../vendor/open-intelligent-ui/node_modules/@openuidev/lang-core/dist/index.mjs";

export const createStore = () => createPersistentStore(createUpstreamStore);
