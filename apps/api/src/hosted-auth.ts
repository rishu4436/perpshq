import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import { createSiweMessage } from 'viem/siwe';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import type { DocumentStore } from './hosted-store';
const cookieName = '__Host-perpshq_session';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
type AuthRecord = {
  kind: 'challenge' | 'session' | 'revoked';
  owner: string;
  id: string;
  origin: string;
  message: string;
  expiresAt: number;
};
export function sessionKey(req: Request) {
  const token = req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? 'auth:' + digest(token) : undefined;
}
export function hostedAuth(
  store: DocumentStore,
  verify: (args: { address: Address; message: string; signature: Hex }) => Promise<boolean>,
) {
  const router = Router();
  const sameOrigin: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.get('origin') !== `https://${req.get('host')}`) {
      res.status(403).json({ error: 'A same-origin browser request is required' });
      return;
    }
    next();
  };
  router.use(sameOrigin);
  async function owner(req: Request) {
    const key = sessionKey(req),
      saved = key ? await store.get<AuthRecord>(key) : null;
    return saved?.value.kind === 'session' &&
      saved.value.expiresAt > Date.now() &&
      saved.value.origin === `https://${req.get('host')}`
      ? saved.value.owner
      : null;
  }
  router.get('/session', async (req, res) => {
    try {
      res.json({ owner: await owner(req), available: true });
    } catch {
      res.status(503).json({ error: 'Strategy storage is unavailable. Signing is paused.' });
    }
  });
  router.post('/auth/challenge', async (req, res) => {
    try {
      const { account } = z
        .object({ account: z.string().regex(/^0x[a-fA-F0-9]{40}$/), chainId: z.literal(50383) })
        .strict()
        .parse(req.body);
      const origin = `https://${req.get('host')}`,
        issuedAt = new Date(),
        expiresAt = new Date(Date.now() + 300000),
        id = randomUUID(),
        token = randomBytes(32).toString('hex');
      const message = createSiweMessage({
        address: account as Address,
        chainId: 50383,
        domain: new URL(origin).host,
        uri: origin,
        version: '1',
        nonce: randomBytes(16).toString('hex'),
        issuedAt,
        expirationTime: expiresAt,
        requestId: id,
        statement: 'Sign in to PerpsHQ Agent Studio. This does not authorize transactions.',
      });
      if (
        !(await store.create(
          'auth:' + digest(token),
          {
            kind: 'challenge',
            owner: account.toLowerCase(),
            id,
            origin,
            message,
            expiresAt: expiresAt.getTime(),
          },
          expiresAt.getTime(),
        ))
      )
        throw new Error('Challenge conflict');
      res.cookie(cookieName, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 300000,
      });
      res.json({ id, message, expiresAt: expiresAt.getTime() });
    } catch {
      res.status(422).json({ error: 'Could not create a wallet sign-in challenge' });
    }
  });
  router.post('/auth/verify', async (req, res) => {
    try {
      const b = z
        .object({
          id: z.string().uuid(),
          signature: z
            .string()
            .max(4098)
            .regex(/^0x(?:[a-fA-F0-9]{2})+$/),
        })
        .strict()
        .parse(req.body);
      const key = sessionKey(req),
        saved = key ? await store.get<AuthRecord>(key) : null;
      if (
        !key ||
        !saved ||
        saved.value.kind !== 'challenge' ||
        saved.value.id !== b.id ||
        saved.value.origin !== `https://${req.get('host')}` ||
        saved.value.expiresAt <= Date.now()
      )
        throw new Error('Invalid or expired challenge');
      if (
        !(await verify({
          address: saved.value.owner as Address,
          message: saved.value.message,
          signature: b.signature as Hex,
        }))
      )
        throw new Error('Signature does not match wallet');
      const expiresAt = Date.now() + 86400000;
      if (
        !(await store.swap(
          key,
          saved.revision,
          { ...saved.value, kind: 'session', expiresAt },
          expiresAt,
        ))
      )
        throw new Error('Challenge already used');
      const token = req.headers
        .cookie!.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith(cookieName + '='))!
        .slice(cookieName.length + 1);
      res.cookie(cookieName, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 86400000,
      });
      res.json({ owner: saved.value.owner });
    } catch {
      res
        .status(401)
        .json({ error: 'Wallet sign-in failed or the challenge expired. Sign in again.' });
    }
  });
  router.post('/auth/logout', async (req, res) => {
    const key = sessionKey(req),
      saved = key ? await store.get<AuthRecord>(key) : null;
    if (key && saved)
      await store.swap(
        key,
        saved.revision,
        { ...saved.value, kind: 'revoked' },
        Date.now() + 60000,
      );
    res.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    res.json({ signedOut: true });
  });
  const requireOwner: RequestHandler = async (req, res, next) => {
    try {
      const address = await owner(req);
      if (!address) {
        res.status(401).json({ error: 'Sign in with your connected wallet first' });
        return;
      }
      res.locals.owner = address;
      next();
    } catch {
      res.status(503).json({ error: 'Strategy storage is unavailable. Signing is paused.' });
    }
  };
  return { router, requireOwner, sameOrigin };
}
