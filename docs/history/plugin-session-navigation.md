# plugin-session-navigation · 历史记录

自功能卡 [docs/features/plugin-session-navigation.md](../features/plugin-session-navigation.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-18 — Host-authoritative blank reuse passed 25 boundary tests, 272 workspace tests, and both real-browser New Session/first-send/reload flows; old logs stayed unchanged. 2026-09-17 — alpha.1 post-merge drift remediation: `conversation.hero.workspace` now gated by `hero` at construction (no workspace-picker slot fire for presentation-owned sessions); skeleton/input-bar specs assert the current `添加文件或调用指令` launcher; vendor GUI suite green. 2026-09-09 — managed-session header/titlebar integration passed 160 focused client tests, the full client TypeScript check, and the official build. Live Electron verified Bot and room sessions retain their real title and shared composer while preset, trajectory, Session log, branch and Commit controls are absent; root panel/window controls remain, and an ordinary New Session still shows Session log, branch and Commit. Conversation 35/35 and dshbot browser 49/49 passed. A blank plugin Session with an elected composer-overlay body removes the ordinary blank canvas from flex layout; live Electron verified the new room body uses the full 846px conversation height with zero document overflow. Real dshbot full-shell acceptance verifies fixed first-prompt IDs, blank-session non-reuse, docked input, list/search isolation and Host restart history. Existing preview Bot/room sessions also verified in isolated Electron. |
