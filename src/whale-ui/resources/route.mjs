import { net } from 'electron';
import { createResourceHandlers } from './handlers.mjs';

const handler = createResourceHandlers((input, init) => net.fetch(input, init));
export function GET(request) {
  return handler(__WHALE_RESOURCE_OPERATION__, Object.fromEntries(new URL(request.url).searchParams));
}
