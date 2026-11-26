'use strict';

/**
 * Open the Settings -> Models custom provider form and switch to the Custom tab when present.
 * @param {any} wc
 * @param {{ waitUntil: (probe: () => Promise<any>, timeoutMs: number) => Promise<any>, pageScript: (wc: any, body: string, args?: any) => Promise<any> }} helpers
 * @returns {Promise<{ clickedAdd: any, customMode: any, form: any, detail: string }>}
 */
async function openCustomProviderForm(wc, { waitUntil, pageScript }) {
  const clickedAdd = await waitUntil(() => pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    if (!dialog) return null;
    if (dshField('^provider id$', dialog)) return 'already-open';
    const btn = dshFind('add model provider|添加模型提供商', dialog);
    if (!btn || btn.disabled) return null;
    btn.click();
    return 'clicked';
  `), 8_000);
  const customMode = await waitUntil(() => pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    if (!dialog) return false;
    if (dshField('^provider id$', dialog)) return true;
    const tab = Array.from(dialog.querySelectorAll('[role="tab"]'))
      .find((el) => dshShown(el) && /custom model api|自定义模型 api/i.test(dshLabel(el)));
    if (!tab || tab.disabled) return false;
    tab.click();
    return true;
  `), 8_000);
  const form = await waitUntil(() => pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    const route = dialog && dshField('^provider id$', dialog);
    return route && dshShown(route) ? true : null;
  `), 8_000);
  const detail = form ? '' : JSON.stringify(await pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    const btn = dialog && dshFind('add model provider|添加模型提供商', dialog);
    const tabs = dialog ? Array.from(dialog.querySelectorAll('[role="tab"]')).map((el) => dshLabel(el)) : [];
    return { dialog: Boolean(dialog), addDisabled: btn?.disabled ?? null, tabs };
  `));
  return { clickedAdd, customMode, form, detail };
}

module.exports = { openCustomProviderForm };
