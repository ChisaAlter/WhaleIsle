'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.argv[2];
const userData = path.join(directory, 'profile');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 220, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, ...args) => {
    const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (details.level >= 3 || details.level === 'error') errors.push(details.message);
  });
  const js = source => win.webContents.executeJavaScript(source);
  try {
    await win.loadFile(path.join(directory, 'index.html'));
    win.webContents.debugger.attach('1.3');
    const motion = value => win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
    await motion('no-preference');
    const read = () => js(`Object.fromEntries([...document.querySelectorAll('button')].map(button => {
      const track = button.querySelector('[class*="feedbackLabel"]');
      const viewport = track?.parentElement;
      const box = button.getBoundingClientRect();
      const style = track && getComputedStyle(track);
      return [button.id, { display: button.getAttribute('data-feedback-display'), busy: button.getAttribute('aria-busy'),
        disabled: button.disabled, label: track?.textContent || '', text: button.textContent, ariaLabel: button.getAttribute('aria-label'),
        hidden: !!track && (style.visibility === 'hidden' || !!track.closest('[aria-hidden="true"]')),
        animation: style?.animationName || 'none', transform: style?.transform || 'none', color: style?.color,
        distance: -(parseFloat(track?.style.getPropertyValue('--button-feedback-distance')) || 0), viewportWidth: viewport?.clientWidth,
        spinner: !!button.querySelector('[data-state="ongoing"]'), geometry: { left: box.left, width: box.width, height: box.height } }];
    }))`);
    const readImReferences = () => js(`Object.fromEntries([...document.querySelectorAll('[data-im-native]')].map(native => {
      const id = native.getAttribute('data-im-native'), shared = document.getElementById('im-ref-' + id + '-shared');
      const properties = ['display', 'boxSizing', 'height', 'minHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'gap', 'borderTopWidth', 'borderTopStyle', 'borderRadius', 'color', 'backgroundColor'];
      const read = button => {
        const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
        return { geometry: { width: rect.width, height: rect.height }, style: Object.fromEntries(properties.map(name => [name, style[name]])),
          type: button.type, text: button.textContent, busy: button.getAttribute('aria-busy'), disabled: button.disabled };
      };
      return [id, { native: read(native), shared: read(shared) }];
    }))`);
    const themes = [];
    for (const theme of ['light', 'dark']) {
      await js(`document.body.toggleAttribute('data-ds-dark-theme', ${theme === 'dark'}); feedbackBench.render('idle')`);
      const before = await read();
      const imBefore = await readImReferences();
      await js("feedbackBench.render('busy')");
      await delay(60);
      const busy = await read();
      const imBusy = await readImReferences();
      const edges = await js(`['short','english','im','compact'].map(id => {
        const button = document.getElementById(id), track = button.querySelector('[class*="feedbackLabel"]'), viewport = track.parentElement;
        const animation = track.getAnimations()[0]; animation.pause();
        const duration = Number(animation.effect.getTiming().duration);
        animation.currentTime = 0;
        const start = track.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
        const spinner = button.querySelector('[data-state="ongoing"]'), spinnerBefore = spinner.getBoundingClientRect().left;
        animation.currentTime = duration * .5;
        const end = track.getBoundingClientRect().right - viewport.getBoundingClientRect().right;
        return { id, start, end, spinnerMoved: spinner.getBoundingClientRect().left !== spinnerBefore };
      })`);
      await js(`window.trackBefore = document.querySelector('#english [class*="feedbackLabel"]'); window.animationBefore = trackBefore.getAnimations()[0]; animationBefore.currentTime = Number(animationBefore.effect.getTiming().duration) * .3; animationBefore.play(); window.timeBefore = animationBefore.currentTime; feedbackBench.render('busy-progress')`);
      await delay(120);
      const continuity = await js(`({ sameNode: trackBefore === document.querySelector('#english [class*="feedbackLabel"]'), sameAnimation: animationBefore === trackBefore.getAnimations()[0], advanced: animationBefore.currentTime > timeBefore })`);
      await motion('reduce');
      await delay(20);
      const reduced = (await read()).english;
      await motion('no-preference');
      await js("feedbackBench.render('result')");
      await delay(450);
      const result = await read();
      await js("feedbackBench.render('idle')");
      const restored = await read();
      const imRestored = await readImReferences();
      themes.push({ theme, before, busy, edges, continuity, reduced, result, restored, imReferences: { before: imBefore, busy: imBusy, restored: imRestored } });
    }
    console.log('BUTTON_RESULT:' + JSON.stringify({ themes, errors }));
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
    app.exit(process.exitCode || 0);
  }
}).catch(error => { console.error(error); app.exit(1); });
