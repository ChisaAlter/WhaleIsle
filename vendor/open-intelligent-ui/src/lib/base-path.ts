// The path the app is served under, set at build time. Unset, the app runs at the root. On
// openui.com the docs app proxies a path such as /demo/intelligent-ui to this deployment, so
// that deployment sets NEXT_PUBLIC_BASE_PATH to the same path. Next adds it to links, redirects
// and its own assets; paths written by hand (fetch calls, files in public/, history URLs) go through withBase().
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/+$/, "") ?? "";

export const withBase = (path: string) => `${BASE_PATH}${path}`;
