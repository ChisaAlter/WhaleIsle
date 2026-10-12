/** Existing Connection authentication admits browser commands; model calls use the same service with an explicit Agent. */
export function registerProjectTransport(ctx, service) {
  ctx.inject(['connection', 'webServer'], host => host.effect(() => host.webServer.register({
    kind: 'prefix', path: '/dsh-project',
    async handler(req, res) {
      const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const admission = host.connection.admit(req);
      if ('rejection' in admission) return reply(admission.rejection, { error: 'Project connection is not authorized.' });
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const endpoint = pathname.slice('/dsh-project/'.length);
      if (req.method !== 'POST' || !pathname.startsWith('/dsh-project/') || !/^[a-zA-Z0-9_/-]+$/.test(endpoint) || endpoint.includes('..')) return reply(404, {});
      if (String(req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') return reply(415, {});
      let body;
      try {
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 512000) return reply(413, {}); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch { return reply(400, { error: 'Invalid Project request JSON.' }); }
      if (body.type !== 'client-request' || body.method !== endpoint || typeof body.rpcId !== 'string') return reply(400, {});
      let result;
      try { result = { ok: true, value: await service.command(endpoint, body.payload, { role: 'user' }) }; }
      catch (error) { result = { ok: false, error: { code: `project/${error.code ?? 'rejected'}`, message: error.message, details: {} } }; }
      reply(200, { type: 'server-response', rpcId: body.rpcId, result });
    },
  })));
}
