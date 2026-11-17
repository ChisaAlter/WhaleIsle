# Three critical boundary modules (#450)

Run `node scripts/mutation-critical.mjs --output <report.json>` from the repository. The fixed scope is `ipc-authorization`, `workspace-authority`, and `local-url`: ten deliberate security-policy faults per module. Each candidate runs that module's existing behavior tests, after its unchanged baseline passes. This is a bounded fault-finding exercise, not exhaustive mutation coverage or a score gate; survivor counts do not determine success.

The child process replaces one CommonJS module in memory. It does not edit the working tree, copy a runtime, install dependencies, or share writable dependencies. A candidate must pass a syntax check. Test crashes, missing TAP summaries and timeouts are infrastructure errors, not detected faults. A task-owned temporary directory holds candidates and synthetic profiles and is reclaimed through `withOwnedTempDir`; the caller chooses a report path outside it. The runner's tests exercise success, baseline failure, invalid syntax, process crash and timeout cleanup.

The Linux run on 2026-11-17 initially detected 23 of 30 faults. Seven survived. Added behavior assertions cover five missing checks: an unregistered contents cannot gain the boot or launcher role by loading its URL; an existing boot or launcher loses its role on remote navigation; loopback hostnames using FTP/WebSocket/file protocols do not gain HTTP permission. These are direct policy tests and also run in ordinary `npm test`.

The final Linux run detected 28 faults and retained two survivors, both in `workspace-authority`:

- `cwd-git-metadata`: removing the early native-path `.git` check is still stopped by the trusted-root-relative `.git` segment check for the Linux paths used here. The early check protects Windows native/DOS-name identity as well; Linux cannot demonstrate that Windows-specific distinction. The guard remains in production, with existing Windows DOS-name tests retained. No duplicate assertion was added solely to change this count.
- `relative-traversal`: removing the early lexical traversal rejection is still stopped by the deepest-existing-node realpath containment check before a target is returned. Existing traversal and symlink-escape behavior tests pass because that second guard rejects the same unsafe requests. The early guard remains in production; no artificial interaction-count assertion was added.

The JSON report names every mutation and the behavior tests that detect it. Logs and JSON evidence are attached/referenced in the PR and are not committed here. Only Linux mutation execution is claimed; normal behavior tests continue to run on the repository's Windows/macOS/Linux CI lanes.
