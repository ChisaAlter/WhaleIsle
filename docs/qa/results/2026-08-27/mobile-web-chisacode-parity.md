# Mobile/Web ChisaCode parity QA

Date: 2026-08-27

Branch: `cursor/mobile-web-full-parity-ed5c-0436`

Plan: [mobile/web ChisaCode parity](../../../superpowers/plans/2026-08-27-mobile-web-chisacode-parity.md)

## Automated results

| Gate | Result | Evidence |
| --- | --- | --- |
| Baseline `node --test "mobile/web/**/*.test.js"` | PASS | 67 pass, 0 fail before implementation |
| ChisaCode parity adapter tests | PASS | 8 pass, including createAgent discovery, Git mapping/actions, branches, structured errors, and files |
| `npm run prepare:chisacode-remote` + browser bundle regeneration | PASS | Vendored server/client stack built; bundle contains createAgent, checkout, branch, PR, and file methods |
| Final `node --test "mobile/web/**/*.test.js"` | PASS | 75 pass, 0 fail |
| Focused remote/session/scan gate | PASS | 26 pass, 0 fail, 1 environment-dependent missing-dist test skipped because dist was built |
| Android JVM tests | BLOCKED | Gradle 8.9 started, then stopped before task execution: no `ANDROID_HOME` or `mobile/android/local.properties` SDK path |
| Android debug APK assemble | BLOCKED | Same missing Android SDK; no APK claim |

## Manual test matrix

| Surface / path | Result | Notes |
| --- | --- | --- |
| Bundled SPA assets load in Chrome 148 | PASS | 390×844 viewport; `/`, `app.js`, `chisacode/parity.js`, and daemon bundle all returned 200; no page/console errors |
| Invalid/missing offer shows pairing guidance | PASS | Paste without offer → `链接无效`; malformed hash → `无效的配对链接（需要 ChisaCode offer v2）` |
| Live relay + desktop offer-v2 pairing | BLOCKED | Cloud worker has no Trent desktop pairing offer/control relay session |
| Phone `createAgent` against Trent desktop | BLOCKED | Requires the live pairing above |
| Git/file RPC against Trent workspace | BLOCKED | Requires the live pairing above |
| Sticky reconnect after browser/device restart | BLOCKED | Requires paired `deviceSecret` and Trent desktop |
| Desktop device revoke / phone reconnect rejection | BLOCKED | Requires paired physical/browser client and Trent desktop |
| Physical Android install/WebView | BLOCKED | No physical device is attached to the cloud worker |

Browser asset checks do not substitute for relay, physical-device, WebView persistence, or real-provider validation. Blocked rows remain release acceptance work.

Browser evidence: [mobile-web-invalid-offer.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-invalid-offer.png).

## Self-review and adversarial review

- PASS — ChisaCode `createSession`, Git, branch, PR, and file paths branch to daemon methods before any legacy `call`/`shell` helper.
- PASS — Structured checkout/branch/action errors and thrown transport errors reach banners or toasts; agent-directory failure is no longer silently swallowed.
- PASS — Missing plain-branch-create and desktop-window RPCs are not faked: those controls are disabled with computer-side guidance.
- PASS — Changed user documentation contains no cookie/JSON login, Bearer Host API, `RemoteGateway`, `/__remote__/login`, or `/__remote__/shell/*` product instructions.
- PASS — No new color values or CSS skin were added; the existing SPA continues to consume `--dsw-alias-*` tokens.
- FOUND/FIXED — Browser review caught a relay-origin paste placeholder. It now shows the local `http://192.168.x.x:3180/#offer=…` landing shape.
- ACCEPTED LEGACY — Old Host helper modules/tests remain only as compatibility code; ChisaCode startup and connected paths do not import them as the product transport.
- BLOCKED — Relay E2EE, real provider launch, deviceSecret persistence/revoke, and Android WebView behavior need Trent’s desktop plus a physical Android device or SDK-backed emulator.
