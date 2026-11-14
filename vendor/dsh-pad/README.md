# Desktop dsh-pad runtime

Vendored from [ChisaAlter/dsh-pad](https://github.com/ChisaAlter/dsh-pad), release `v0.3.1`, commit `b4a9b05a4e4ace822a629f4f0ba9c364b9422a95`, under the MIT license. The bundle patch is unmodified. The host bundle disables UpdateService because desktop releases own this copy. The client keeps two desktop extensions: the floating ball preserves its stored point across the initial 0×0 viewport (`src/main/dsh-pad-ball.test.js`), and the additive `whale.panels` seat reuses the same client, cards, iframe renderer, readings and approvals inside Big Fish mode. The manifest declares the shared primitives used by that seat. Source maps and development files are omitted.

WhaleIsle loads the floating panel dock by default through `src/main/dsh-pad-desktop.js`. Harness resolves the linked package's peer dependencies to the running installation. No second Harness dependency tree is shipped with this plugin.

An existing user-installed `dsh-pad` bundle takes precedence on normal starts, keeping its profile/home configuration and any custom data path. Recovery starts use the shipped copy through the separate `whaleisle-desktop-pad` package link. User package directories, manifest selections and patch files are preserved; an explicit disable is honored.

Panels, cached readings and refresh state use the plugin's default `$DSH_HOME/dsh-pad` location when no user installation overrides it. No migration deletes or relocates that data.

The desktop default patch precedes profile/home overrides so the plugin manager can persist disabling and custom panel paths without rewriting user files. Recovery omits those user patches. The host bundle disables its in-place updater even when a user replaces the whole config; desktop releases provide its updates. Data-source approvals and the plugin's other defaults remain in effect.

The embedded seat keeps its own visible-panel order and removal preferences; it never deletes panel definitions or rewrites the floating dock layout. Its visible panels join the existing stream's watched set. Add/edit requests append to the existing conversation draft without sending it. Updating an independently installed user copy is still the user's choice; a copy without this seat continues to provide its floating dock, while the assistant reports that an embedding-capable pad version is needed.

To update the snapshot, copy the same runtime files from a reviewed upstream release, record its commit here, retain these local extensions unless upstream includes them, run the pad desktop tests and the real CLI composition check, then restart the repository desktop and verify both panel entries.
