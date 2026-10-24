# DESKTOP-FORK.md — vendor/dsh-task-control 桌面自有插件

`dsh-task-control` is desktop-owned (not vendored from an upstream repo): it
implements the Host side of the quit/update task-protection flow —
admission lock, work inspection, and the loopback control route — for
[docs/features/task-protection.md](../../docs/features/task-protection.md).

It is mounted on EVERY `dsh web` start (full and `--skip-user-plugins`) via
the desktop overlay `desktop-plugins/dsh-task-control/desktop-task-control.patch.yml`;
the profile `cordis.patch.yml` is never written. Missing or damaged files fail
the start as desktop runtime damage — skip mode cannot repair them.

Upstream seams consumed (do not casually re-shape):

- `connection/request` waterfall + `webServer.register/registerUpgrade/
  registerFallback` — HTTP/WS admission gates (`packages/host/webserver`,
  `packages/client/connection`).
- `sessionController.resolveAgent` / `jobs.start` — the chokepoints Schedule
  runtime, IM channels, and Typert lookups all pass through.
- `schedule.catalog()` + `schedule.runtime.requestDrive()` — inspection and
  post-unlock re-drive of refused due deliveries.
- `workspace/session-activity` — parity with upstream quit-inspection for
  loaded-session reminders.
