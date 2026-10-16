import { net } from 'electron';

// The harness uses Electron's default session. Resource handlers must share
// its Chromium networking and system proxy instead of Node's global fetch.
export function fetch(input, init) {
  return net.fetch(input, init);
}
