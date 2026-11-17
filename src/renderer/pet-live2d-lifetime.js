'use strict';

// The pet page owns these resources. Navigation/close cancels all producers
// together, including callbacks already queued before an asynchronous mount.
const petLifetime = (() => {
  let disposed = false;
  const listeners = new Set();
  const timeouts = new Set();
  const intervals = new Set();
  const frames = new Set();
  const keep = (release) => {
    if (typeof release !== 'function') { return; }
    if (disposed) { release(); }
    else { listeners.add(release); }
  };
  return {
    get disposed() { return disposed; },
    keep,
    listen(target, type, callback, options) {
      if (!target || disposed) { return () => {}; }
      target.addEventListener(type, callback, options);
      const release = () => {
        target.removeEventListener(type, callback, options);
        listeners.delete(release);
      };
      keep(release);
      return release;
    },
    timeout(callback, delay) {
      if (disposed) { return 0; }
      const id = setTimeout(() => {
        timeouts.delete(id);
        if (!disposed) { callback(); }
      }, delay);
      timeouts.add(id);
      return id;
    },
    clearTimeout(id) { clearTimeout(id); timeouts.delete(id); },
    interval(callback, delay) {
      if (disposed) { return 0; }
      const id = setInterval(() => { if (!disposed) { callback(); } }, delay);
      intervals.add(id);
      return id;
    },
    clearInterval(id) { clearInterval(id); intervals.delete(id); },
    frame(callback) {
      if (disposed) { return 0; }
      const id = requestAnimationFrame((now) => {
        frames.delete(id);
        if (!disposed) { callback(now); }
      });
      frames.add(id);
      return id;
    },
    dispose() {
      if (disposed) { return; }
      disposed = true;
      for (const release of listeners) { release(); }
      listeners.clear();
      for (const id of timeouts) { clearTimeout(id); }
      for (const id of intervals) { clearInterval(id); }
      for (const id of frames) { cancelAnimationFrame(id); }
      timeouts.clear(); intervals.clear(); frames.clear();
    },
  };
})();
petLifetime.listen(window, 'beforeunload', () => petLifetime.dispose());
