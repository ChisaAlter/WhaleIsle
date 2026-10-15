/** Bind vendored client build scripts to the desktop's locked build tool. */
import { registerHooks } from 'node:module';

// The tracked plugin node_modules include Windows-only esbuild dependencies.
// On macOS their older JS host can otherwise resolve the desktop's newer
// native binary. Resolve both halves through the root package instead.
const esbuild = import.meta.resolve('esbuild');
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'esbuild' ? esbuild : specifier, context);
  },
});
