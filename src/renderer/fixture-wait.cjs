'use strict';

// Bounded polling shared by the real-Electron fixture children. A fixed sleep
// followed by a read of asynchronously produced state (rendering, animation
// clocks, timers, focus, IPC round trips) flakes under a slow runner: every
// wait must observe an actual condition or be a deliberate negative-proof
// window with an explaining comment.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Poll `expression` inside the renderer until it is truthy. The loop runs in a
// single executeJavaScript call so a busy IPC channel cannot starve the poll.
const waitForDom = (js, expression, timeoutMs = 5000) => js(`new Promise((resolve, reject) => {
  const deadline = Date.now() + ${Number.isFinite(timeoutMs) ? timeoutMs : 5000};
  const poll = () => {
    if (${expression}) return resolve(true);
    if (Date.now() >= deadline) return reject(new Error('fixture DOM did not settle: ' + ${JSON.stringify(expression)}));
    setTimeout(poll, 20);
  };
  poll();
})`);

// Poll a main-process predicate (fixture IPC bookkeeping, console tails).
// `predicate` may be async; `label` names the condition for the timeout error.
async function waitForMain(predicate, label = 'fixture main-process condition', timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out: ${label}`);
    await delay(10);
  }
}

module.exports = { delay, waitForDom, waitForMain };
