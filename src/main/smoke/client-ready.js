'use strict';

/** The boot document is never a substitute for the asynchronously created Harness view. */
async function waitForHarnessContents(getContents, owner, timeoutMs = 300_000, getWelcomeContents = () => null, getStartupFailure = () => null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = getStartupFailure();
    if (failure) throw new Error(`Desktop startup failed: ${failure}`);
    const welcome = getWelcomeContents();
    if (welcome && !welcome.isDestroyed()) {
      throw new Error('Unexpected welcome window: desktop must enter the workspace directly');
    }
    const contents = getContents(owner);
    if (contents && !contents.isDestroyed()) return contents;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Harness WebContents was not created before the smoke deadline');
}

module.exports = { waitForHarnessContents };
