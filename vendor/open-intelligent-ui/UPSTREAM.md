# Upstream provenance

- Repository: <https://github.com/thesysdev/open-intelligent-ui>
- Pinned commit: [`6a4a0ba192ea285b3a5ed39dcc1295d7d4080d6f`](https://github.com/thesysdev/open-intelligent-ui/commit/6a4a0ba192ea285b3a5ed39dcc1295d7d4080d6f)
- Pinned source tree: <https://github.com/thesysdev/open-intelligent-ui/tree/6a4a0ba192ea285b3a5ed39dcc1295d7d4080d6f>
- Retrieved: 2026-10-16

## Snapshot and local integration

Retain the complete upstream source tree and bundled media, including the comparison image and video under `docs/`. This provenance file is a local addition, not an upstream file.

The local integration patch is limited to adapting the MapLibre worker URL source for the host's asset loading. It must retain the map implementation and functionality.

The local `pnpm-lock.yaml` was imported from the upstream `package-lock.json` with `pnpm import --ignore-workspace` for standalone frozen-lockfile installation; `package.json` and `package-lock.json` remain the original upstream snapshot.

## Dependency licenses

The pinned source snapshot has no separate `LICENSE`, `COPYING`, or `NOTICE` file, and its `package.json` does not declare a license.

The OpenUI SDK packages are separately licensed. The following versions are pinned by the upstream lockfile; their published packages contain the MIT license:

| Package | Version | Published package metadata |
| --- | --- | --- |
| `@openuidev/lang-core` | `1.0.0` | <https://registry.npmjs.org/@openuidev%2flang-core/1.0.0> |
| `@openuidev/react-lang` | `1.0.0` | <https://registry.npmjs.org/@openuidev%2freact-lang/1.0.0> |
| `@openuidev/react-ui` | `0.18.1` | <https://registry.npmjs.org/@openuidev%2freact-ui/0.18.1> |
| `@openuidev/cli` | `0.4.1` | <https://registry.npmjs.org/@openuidev%2fcli/0.4.1> |

The SDK source is maintained in <https://github.com/thesysdev/openui>. Preserve its [MIT license](https://github.com/thesysdev/openui/blob/main/LICENSE), copyright and permission notices. The viewer build copies the runtime SDK licenses to `OPENUI-SDK-LICENSES.txt` beside the generated viewer.
