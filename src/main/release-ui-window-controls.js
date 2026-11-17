// The walkthrough must inspect the controls supplied by each desktop platform.
async function probeWindowControls(wc) {
  const web = await wc.executeJavaScript(`(() => {
    const host = document.getElementById('dshd-shell-controls');
    if (!host) return null;
    return ['minimize', 'maximize', 'close'].every(action =>
      Boolean(host.querySelector('[data-act="' + action + '"]')));
  })()`);
  if (process.platform === 'darwin') {
    const win = require('./window').getMainWindow();
    const native = require('./smoke/macos-chrome').cocoaButtons().snapshot(win);
    return {
      ok: web === null && native.buttons.length === 3
        && native.buttons.every(button => button.present && !button.hidden && button.enabled),
      detail: `native AppKit buttons: ${JSON.stringify(native.buttons)}`,
    };
  }
  return { ok: web === true, detail: web ? '' : 'injected window-control plate missing or incomplete' };
}

module.exports = { probeWindowControls };
