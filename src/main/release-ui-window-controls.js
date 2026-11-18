// The walkthrough must inspect the controls supplied by each desktop platform.
/** @param {Electron.WebContents} wc */
async function probeWindowControls(wc) {
  const web = await wc.executeJavaScript(`(() => {
    const host = document.getElementById('dshd-shell-controls');
    if (!host) return { present: false, hidden: true, hasAnyAct: false, hasAllAct: false };
    const display = (typeof getComputedStyle === 'function' ? getComputedStyle(host)?.display : '')
      || host.style?.display;
    const hidden = Boolean(
      host.hidden
      || (typeof host.hasAttribute === 'function' && host.hasAttribute('hidden'))
      || display === 'none'
    );
    const hasAllAct = ['minimize', 'maximize', 'close'].every(action =>
      Boolean(host.querySelector('[data-act="' + action + '"]')));
    const hasAnyAct = Boolean(
      host.querySelector('[data-act]')
      || ['minimize', 'maximize', 'close'].some(action => Boolean(host.querySelector('[data-act="' + action + '"]')))
    );
    return { present: true, hidden, hasAnyAct, hasAllAct };
  })()`);
  if (process.platform === 'darwin') {
    const win = require('./window').getMainWindow();
    const native = require('./smoke/macos-chrome').cocoaButtons().snapshot(win);
    const webOk = !web.hasAnyAct && (!web.present || web.hidden);
    const nativeOk = native.buttons.length === 3
      && native.buttons.every(button => button.present && !button.hidden && button.enabled);
    return {
      ok: webOk && nativeOk,
      detail: webOk
        ? `native AppKit buttons: ${JSON.stringify(native.buttons)}`
        : `web controls=${JSON.stringify(web)}; native AppKit buttons: ${JSON.stringify(native.buttons)}`,
    };
  }
  const ok = Boolean(web.present && web.hasAllAct);
  return { ok, detail: ok ? '' : 'injected window-control plate missing or incomplete' };
}

module.exports = { probeWindowControls };
