/** Keep the source-owned package's exact dependency pins synchronized before building. */

/** Clone the install environment; pnpm must accept node_modules replacement without a terminal. */
export function whaleUiInstallEnvironment(environment, interactive) {
  return interactive ? { ...environment } : { ...environment, CI: 'true' };
}

/**
 * Install only when a controlled dependency is missing or has a different exact version.
 * Version reads and installation belong to the caller; return whether installation occurred
 * so an otherwise matching artifact stamp cannot skip the subsequent build.
 */
export function synchronizeWhaleUiDependencies({ manifest, installedVersion, install }) {
  const expected = { ...manifest.dependencies, ...manifest.devDependencies };
  const mismatches = () => Object.entries(expected).filter(([name, version]) => installedVersion(name) !== version);
  if (mismatches().length === 0) return false;
  install();
  const remaining = mismatches();
  if (remaining.length > 0) {
    throw new Error(`Whale UI dependencies do not match the manifest after installation: ${remaining.map(([name, version]) => `${name}@${version}`).join(', ')}`);
  }
  return true;
}
