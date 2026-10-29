# Boot page design prototype

Three standalone startup-page directions based on ChatGPT's design plan: A · wide split, B · status poster, and C · diagnostic margin. This folder is an isolated review artifact; it does not change or ship with the Electron boot page.

Open `index.html` directly. In PowerShell from the repository root:

```powershell
Start-Process .\prototypes\boot-page\index.html
```

Use the bottom switcher or `?variant=a`, `?variant=b`, and `?variant=c`. Append `&presentation=clean` to hide the prototype controls for a full-viewport presentation; this does not change the layout dimensions. Shareable examples include:

- `?variant=a&presentation=clean`
- `?variant=b&state=error&presentation=clean`
- `?variant=c&state=scheduled&theme=dark&presentation=clean`

The state selector includes sample startup, known/unknown plugin loading, settled failure, scheduled restart, and restarting fixtures. Theme and reduced-motion controls are also available. When the operating system forces reduced motion, the control reports `系统开启` and cannot claim motion is enabled. All fixture data is illustrative, and the displayed actions are not connected to the application.

## macOS details

The platform selector defaults to macOS on a Mac; `?platform=mac` and `?platform=windows` select an explicit preview. Mac mode adds a simulated system menu, a 48px titlebar with an 80px leading safe area, native-control placement, and Command shortcut hints. The Whale Isle menu opens a preview of Settings, Hide and Quit; outside click or Escape dismisses it. These actions explain the real app behavior without controlling the browser.

The Mac window selector previews active, inactive (gray controls) and full-screen states. Full screen removes the window corners and titlebar; AppKit's actual mouse-at-top reveal is not simulated. The colored dots are illustrative, not working native buttons. The original A/B/C layouts, startup fixtures, theme and reduced-motion settings remain available on both platforms.

- `?variant=a&platform=mac&window=active`
- `?variant=b&platform=mac&window=inactive&theme=dark`
- `?variant=c&platform=mac&window=fullscreen&presentation=clean`

This prototype is not shipped. Check the actual Electron app separately for native editing, Dock restoration and full-screen behavior.
