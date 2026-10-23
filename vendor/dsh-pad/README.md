# Desktop dsh-pad runtime

Vendored from [ChisaAlter/dsh-pad](https://github.com/ChisaAlter/dsh-pad), release `v0.3.1`, commit `b4a9b05a4e4ace822a629f4f0ba9c364b9422a95`, under the MIT license. The manifest, bundle patch and both JavaScript bundles are unmodified release files. Source maps and development files are omitted.

WhaleIsle loads the floating panel dock by default through `src/main/dsh-pad-desktop.js`. Harness resolves the linked package's peer dependencies to the running installation. No second Harness dependency tree is shipped with this plugin.

An existing user-installed `dsh-pad` bundle takes precedence on normal starts, keeping its profile/home configuration and any custom data path. Recovery starts use the shipped copy through the separate `whaleisle-desktop-pad` package link. User package directories, manifest selections and patch files are preserved; an explicit disable is honored.

Panels, cached readings and refresh state use the plugin's default `$DSH_HOME/dsh-pad` location when no user installation overrides it. No migration deletes or relocates that data.

The desktop overlay disables the plugin's in-place update checker (`updateCheck: false`); desktop releases provide its updates. Data-source approvals and the plugin's other defaults remain in effect.

To update the snapshot, copy the same runtime files from a reviewed upstream release, record its commit here, run the pad desktop tests and the real CLI composition check, then restart the repository desktop and verify its floating panel entry.
