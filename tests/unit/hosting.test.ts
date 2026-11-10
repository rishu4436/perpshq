import express from 'express';
import { afterEach, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { hostingPolicy, localControlGuard } from '../../apps/api/src/hosting';
const servers: Server[] = [];
function fetch(url: string, init: { headers?: Record<string, string>; method?: string } = {}) {
  return new Promise<{ status: number; text: () => Promise<string> }>((resolve, reject) => {
    const req = request(url, init, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode!, text: async () => body }));
    });
    req.on('error', reject);
    req.end();
  });
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});
async function endpoint(origin?: string, additional: string[] = []) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(hostingPolicy(origin, 3000, additional).guard);
  app.use('/private', localControlGuard);
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
it('accepts only the exact configured public and deployment origins', async () => {
  const base = await endpoint('https://perps.test', ['https://preview.test']);
  for (const host of ['perps.test', 'preview.test']) {
    expect(
      (await fetch(base + '/health', { headers: { host, origin: `https://${host}` } })).status,
    ).toBe(200);
  }
  const refused: Record<string, string>[] = [
    { host: 'perps.test', origin: 'https://attacker.test' },
    { host: 'attacker.test', 'x-forwarded-host': 'perps.test' },
    { host: 'localhost:3000' },
  ];
  for (const headers of refused)
    expect((await fetch(base + '/health', { headers })).status).toBe(403);
});
it('keeps local controls unavailable for public reads and writes', async () => {
  const base = await endpoint('https://perps.test');
  for (const method of ['GET', 'POST']) {
    const response = await fetch(base + '/private/backup', {
      method,
      headers: { host: 'perps.test' },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('local application');
  }
});
it('preserves local-only defaults and rejects insecure hosting configuration', async () => {
  expect(() => hostingPolicy('http://perps.test', 3000)).toThrow('HTTPS');
  const base = await endpoint();
  expect((await fetch(base + '/health', { headers: { host: 'localhost:3000' } })).status).toBe(200);
  expect((await fetch(base + '/health', { headers: { host: 'perps.test' } })).status).toBe(403);
});
