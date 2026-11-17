// Deliberate policy faults for #450. Each edit must match exactly once.
/** @type {import('../mutation-critical.mjs').MutationModule[]} */
export const modules = [
  {
    file: 'src/main/ipc-authorization.js',
    test: 'src/main/ipc-authorization.test.js',
    mutations: [
      ['destroyed-sender', "|| (typeof sender.isDestroyed === 'function' && sender.isDestroyed())", ''],
      ['child-frame', '|| frame !== sender.mainFrame', ''],
      ['boot-identity', 'sender === surfaces.boot && bootUrl(frame.url)', 'bootUrl(frame.url)'],
      ['harness-identity', 'sender === surfaces.harness && harnessUrl(frame.url, surfaces.harnessOrigin)', 'harnessUrl(frame.url, surfaces.harnessOrigin)'],
      ['launcher-identity', 'sender === surfaces.launcher && launcherUrl(frame.url)', 'launcherUrl(frame.url)'],
      ['boot-url', 'sender === surfaces.boot && bootUrl(frame.url)', 'sender === surfaces.boot'],
      ['harness-origin', 'sender === surfaces.harness && harnessUrl(frame.url, surfaces.harnessOrigin)', 'sender === surfaces.harness'],
      ['launcher-url', 'sender === surfaces.launcher && launcherUrl(frame.url)', 'sender === surfaces.launcher'],
      ['role-allowlist', '!role || !allowed.has(role)', '!role'],
      ['unknown-sender', '\n  return null;\n}', '\n  return IPC_ROLES.HARNESS;\n}'],
    ],
  },
  {
    file: 'src/main/workspace-authority.js',
    test: 'src/main/workspace-authority.test.js',
    mutations: [
      ['directory-only', 'if (!fs.statSync(resolved).isDirectory()) return null;', 'fs.statSync(resolved);'],
      ['cwd-realpath', 'real = logicalRealpathSync(resolved);', 'real = resolved;', 0],
      ['cwd-containment', 'if (!containedIn(root, real)) continue;', 'if (false) continue;'],
      ['cwd-git-metadata', 'if (hasGitMetadataTarget(real)) return null;', ''],
      ['relative-traversal', 'if (escapesBase(fromBase)) return null;', ''],
      ['spelled-git-directory', 'if (hasGitDirSegment(fromBase)) return null;', ''],
      ['target-containment', 'if (!containedIn(base, nodeReal)) return null;', ''],
      ['target-git-metadata', 'if (hasGitDirSegment(path.relative(base, nodeReal)) || hasGitMetadataTarget(nodeReal)) return null;', ''],
      ['dangling-link', 'if (!isAbsentNode(node)) return null;', ''],
      ['registered-risky-root', 'return !isFilesystemRoot(real) && !isHighRiskWorkspaceRoot(real, anchors);', 'return !isFilesystemRoot(real);'],
    ],
  },
  {
    file: 'src/main/local-url.js',
    test: 'src/main/local-url.test.js',
    mutations: [
      ['loopback-protocol', "if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;", ''],
      ['loopback-userinfo', "if (parsed.username !== '' || parsed.password !== '') return false;", ''],
      ['loopback-host', 'return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());', 'return true;'],
      ['exact-origin', 'new URL(String(raw)).origin === new URL(String(expected)).origin', 'new URL(String(raw)).hostname === new URL(String(expected)).hostname'],
      ['expected-loopback', '!isLoopbackHttpUrl(raw) || !isLoopbackHttpUrl(expected)', '!isLoopbackHttpUrl(raw)'],
      ['rewrite-wildcard', "parsed.hostname = '127.0.0.1';", "parsed.hostname = '0.0.0.0';"],
      ['external-scheme', "return parsed.protocol === 'http:' || parsed.protocol === 'https:';", 'return true;'],
      ['packaged-full-path', 'return sameFilePath(candidate, packagedRendererPath(relativeFromRenderer, options.resolvePath));', 'return true;'],
      ['same-document-only', "return typeof nextUrl === 'string' && nextUrl === currentUrl;", "return typeof nextUrl === 'string';"],
      ['redirect-policy', 'return allowUrl(nextUrl);', 'return true;'],
    ],
  },
];
