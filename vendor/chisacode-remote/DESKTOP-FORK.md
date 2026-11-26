# chisacode-remote — Deepseek-Harness-Desktop fork

Vendored from [ChisaCode](https://github.com/ChisaAlter/ChisaCode) (`packages/{protocol,relay,server,client,highlight,cli,app}`) under **AGPL-3.0-or-later**. See `LICENSE` and `NOTICE`.

## Product role

Desktop remote pairing is the **full** ChisaCode stack:

1. `createChisaCodeDaemon` (`packages/server`) — not a hello/handshake slice
2. Cloudflare Worker relay (`packages/relay`) — self-hosted; never ship `relay.chisacode.sh` or their `account_id`
3. Protocol offer v2 + client E2EE (`packages/protocol`, `packages/client`)
4. Phone = same-protocol client (pairing / reconnect / deviceSecret store / session via `DaemonClient`)

MIT shell chrome (settings copy, Electron IPC) stays MIT. AGPL covers this tree and any modified Worker you deploy.

## Defaults (DSH)

| Knob | Env / file | Notes |
| --- | --- | --- |
| Relay host | `CHISACODE_RELAY_ENDPOINT` / `defaults.json` | **Built-in** `ayase.cn:443` (TLS on; runtime authority in `src/shared/lan.js`) |
| App base (QR URL) | `CHISACODE_APP_BASE_URL` | `https://ayase.cn/dshd` (Away) / LAN `:3180` |
| Home | `userData/chisacode-home` | Sticky device secrets until user 解除 |

## Packaging

- Electron main uses dynamic `import()` of ESM server exports (or `ELECTRON_RUN_AS_NODE` supervisor).
- Source start builds missing/stale server artifacts before Electron launches.
- Packaged builds run `scripts/prepare-chisacode-remote.mjs --force --runtime`; `extraResources` include the built package tree plus a production-only `node_modules`, and `afterPack` imports the shipped server API as a release gate.
- Corresponding source for AGPL network use: this directory in the public repo / release source archive.

## Fork deltas (packages/server)

- `agent/providers/dsh-agent.ts` — `resolveDshVendorDir` passes explicit `stdio: ["ignore","pipe","pipe"]` to `execSync("npm root -g")`. Node only forwards the child's stderr to `process.stderr` when `stdio` is omitted; in the desktop GUI that fd is often a broken pipe and the forwarded write escapes as an uncaught EPIPE (observed crash). `DSH_VENDOR_PACKAGES` is exported so the shell can decide when its bundled harness qualifies as `CHISACODE_DSH_VENDOR_DIR`.
- `exports.ts` — re-exports `DSH_VENDOR_PACKAGES` for the shell (see `src/main/chisacode-remote.js`).
- `websocket-server.ts` — `authorizeRelayPairingToken` stores the hello's `relayDeviceAuth.deviceName` as the issued device label (legacy `relay-pair` fallback), so the desktop device list shows a real name per paired device.
- `relay-pairing-link-store.ts` — a truncated or schema-invalid `relay-pairing-link.json` is quarantined to `<file>.corrupt-<timestamp>` with a warning instead of throwing, so offer minting, `accepts`, and `revoke` keep working (`pairing-offer.ts` / `websocket-server.ts` pass their pino logger; standalone callers fall back to `console.warn`).
- `relay-device-credential-store.ts` — `issueDevice` normalizes labels to ≤120 chars (`DeviceRecordSchema` caps `label` at load; an overlong persisted label would drop the whole store file) and adds `renameDevice(deviceId, label)` for the desktop's shell-side rename IPC; the store is re-opened per hello auth, so shell writes and daemon writes do not clobber each other; `load()` only initializes empty on `ENOENT`, quarantines corrupt/schema-invalid `relay-devices.json` to `<file>.corrupt-<timestamp>` with a warning (`logger.warn` / `console.warn`), and rethrows non-`ENOENT` read/quarantine errors instead of returning empty and overwriting paired devices.

## Fork deltas (packages/client)

- `daemon-client.ts` / `daemon-client-checkout-subscriptions.ts` / `daemon-client-agent-interaction.ts` — bare `crypto.randomUUID()` call sites route through the existing `safeRandomId()` (`daemon-client-transport-utils.ts`). The desktop pairing page is `http://<lan-ip>:3180` — **not a secure context** — so browsers do not expose `crypto.randomUUID` there (localhost QA masks this; real phones hit it). The E2EE stack itself is tweetnacl and never needs `crypto.subtle`. Same rule for new client code: no secure-context-only crypto APIs.
- `daemon-client-connection-controller.ts` — `relayDeviceAuth` config accepts `deviceName` and `buildRelayDeviceAuth` carries it on the first-pairing payload (protocol field is append-only; old daemons ignore it).

## Fork deltas (packages/cli)

- `src/utils/client-id.ts` — the client identity path used to be computed once with `process.env.CHISACODE_HOME ?? join(homedir(), ".chisacode")`, so an empty `CHISACODE_HOME` wrote `cli-client-id` into the process cwd (the repo root, in practice), and a relative value bound identity state to whatever directory the CLI ran from. Home resolution is now a lazy exported `resolveCliClientIdDirectory(env)` that falls back to `~/.chisacode` for unset, empty/whitespace-only, and non-absolute values, while a syntactically absolute path is preserved verbatim. `getOrCreateCliClientId()` keeps its public API and caching.

## Fork deltas (packages/protocol)

- `messages.ts` — `WSHelloMessageSchema.relayDeviceAuth.deviceName` (optional, trimmed, 1–120 chars): client-reported operator label for first pairing, consumed by the server fork above.

## Do not

- Point production at `relay.chisacode.sh` / `app.chisacode.sh` / ChisaCode Cloudflare `account_id`
- Ship a “pairing-only” daemon stub
- Keep DSH HTTP `RemoteGateway` / offer v1 as the main phone path
