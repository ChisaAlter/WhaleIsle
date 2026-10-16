"use strict";

// The viewer has no preload or model credentials. Keep the upstream media, map,
// font and sandboxed HtmlView capabilities; native privileges live in the parent.
const OPENUI_VIEWER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob: https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh",
  "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob: http: https:",
  "media-src data: blob:",
  "connect-src http: https: blob:",
  "worker-src blob: data:",
  "frame-src 'self' about: blob: data: https://www.youtube-nocookie.com",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Only call with the trusted, locally built viewer bundle, never model HTML. */
function createOpenUiDocument({ script, style }) {
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  const safeStyle = style.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${OPENUI_VIEWER_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${safeStyle}</style></head><body><div id="root"></div><script>${safeScript}</script></body></html>`;
}

module.exports = { OPENUI_VIEWER_CSP, createOpenUiDocument };
