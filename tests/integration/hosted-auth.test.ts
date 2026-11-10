import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { request, type Server } from 'node:http';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hostedAuth } from '../../apps/api/src/hosted-auth';
import { MemoryDocuments } from '../hosted-fixtures';
const first = privateKeyToAccount(generatePrivateKey()),
  second = privateKeyToAccount(generatePrivateKey());
let server: Server, base: string, store: MemoryDocuments;
async function send(path: string, body?: unknown, cookie?: string, origin = 'https://perps.test') {
  return new Promise<{ status: number; body: Record<string, unknown>; cookie?: string }>(
    (resolve, reject) => {
      const r = request(
        base + path,
        {
          method: body ? 'POST' : 'GET',
          headers: {
            Host: 'perps.test',
            Origin: origin,
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => {
            text += c;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: JSON.parse(text),
              cookie: res.headers['set-cookie']?.[0],
            }),
          );
        },
      );
      r.on('error', reject);
      r.end(body ? JSON.stringify(body) : undefined);
    },
  );
}
beforeEach(async () => {
  store = new MemoryDocuments();
  const auth = hostedAuth(store, (args) => verifyMessage(args)),
    app = express();
  app.use(express.json());
  app.use(auth.router);
  app.get('/private', auth.requireOwner, (_req, res) => res.json({ owner: res.locals.owner }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function challenge() {
  const r = await send('/auth/challenge', { account: first.address, chainId: 50383 });
  expect(r.status).toBe(200);
  return r;
}
it('requires a signed wallet, binds the nonce to its secure cookie, and consumes it once', async () => {
  expect((await send('/private')).status).toBe(401);
  const c = await challenge();
  expect(c.cookie).toContain('HttpOnly');
  expect(c.cookie).toContain('Secure');
  expect(c.cookie).toContain('SameSite=Strict');
  const signature = await first.signMessage({ message: c.body.message as string });
  expect((await send('/auth/verify', { id: c.body.id, signature })).status).toBe(401);
  expect((await send('/auth/verify', { id: c.body.id, signature }, c.cookie)).status).toBe(200);
  expect((await send('/private', undefined, c.cookie)).body.owner).toBe(
    first.address.toLowerCase(),
  );
  expect((await send('/auth/verify', { id: c.body.id, signature }, c.cookie)).status).toBe(401);
});
it('rejects another wallet signature without consuming the valid challenge', async () => {
  const c = await challenge(),
    bad = await second.signMessage({ message: c.body.message as string });
  expect((await send('/auth/verify', { id: c.body.id, signature: bad }, c.cookie)).status).toBe(
    401,
  );
  const good = await first.signMessage({ message: c.body.message as string });
  expect((await send('/auth/verify', { id: c.body.id, signature: good }, c.cookie)).status).toBe(
    200,
  );
});
it('rejects cross-origin challenge/verification requests and session reuse on another host', async () => {
  expect(
    (
      await send(
        '/auth/challenge',
        { account: first.address, chainId: 50383 },
        undefined,
        'https://attacker.test',
      )
    ).status,
  ).toBe(403);
  expect(store.values.size).toBe(0);
  const c = await challenge();
  const signature = await first.signMessage({ message: c.body.message as string });
  expect(
    (await send('/auth/verify', { id: c.body.id, signature }, c.cookie, 'https://attacker.test'))
      .status,
  ).toBe(403);
  expect((await send('/auth/verify', { id: c.body.id, signature }, c.cookie)).status).toBe(200);
  const row = [...store.values.values()][0];
  (row.document.value as { origin: string }).origin = 'https://other.test';
  expect((await send('/private', undefined, c.cookie)).status).toBe(401);
});
it('expires challenges and revokes existing sessions on logout', async () => {
  const c = await challenge();
  const signature = await first.signMessage({ message: c.body.message as string });
  expect((await send('/auth/verify', { id: c.body.id, signature }, c.cookie)).status).toBe(200);
  expect((await send('/auth/logout', {}, c.cookie)).status).toBe(200);
  expect((await send('/private', undefined, c.cookie)).status).toBe(401);
  const expired = await challenge();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360000);
  expect(
    (await send('/auth/verify', { id: expired.body.id, signature }, expired.cookie)).status,
  ).toBe(401);
});
