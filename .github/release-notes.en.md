# Whale Isle 0.3.15

- **Whale background document tasks**: Pick files and describe the goal in the Whale panel, and she summarizes them in the background from read-only copies, then delivers the result back to the original chat. Tasks can be stopped and resumed after a restart. Feishu `/task` requires granting the bot and the person on the desktop first.
- **Inbox / Outbox**: Two new sidebar entries. Inbox collects discoveries, opportunities and items waiting to be sorted; Outbox is the approval queue showing action, target, risk and policy state, where you can approve or reject in place and the list refreshes afterwards.
- **No more failure popups**: Launcher, main-window and page failures no longer raise native error boxes or floating notices; the failure stays on the page. A crashed or unresponsive page reloads automatically (up to 3 times in 2 minutes), and a final failure shows an in-page error with a retry button.
- **One broken built-in no longer blocks startup**: If an optional built-in (Office runtime, usage stats, messaging channels, plugin market, Whale assistant, remote workspace, floating panel) fails to load, this start skips it and lists the reason in the launcher's startup diagnostics. Task protection still stops the start.
- **macOS installer ships with every version**: A version-bump push now builds the macOS Apple Silicon package and publishes it with the Windows installer.

Windows x64 and macOS Apple Silicon installers are provided (the Mac package is unsigned; right-click and choose Open the first time). Android, WhaleBridge and the ChatGPT plugin are released separately.
