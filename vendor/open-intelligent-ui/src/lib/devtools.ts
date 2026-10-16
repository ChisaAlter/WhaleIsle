// react-lang mounts the OpenUI devtools widget in development unless this flag
// is already set when it loads. Its floating button and deploy card cover the
// composer on a phone, so the chat sets the flag first and shows the widget
// only with NEXT_PUBLIC_OPENUI_DEVTOOLS=1. Import this before any OpenUI package.
if (process.env.NEXT_PUBLIC_OPENUI_DEVTOOLS !== "1") {
  (globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;
}

export {};
