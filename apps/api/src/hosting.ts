import type { RequestHandler } from 'express';

export function hostingPolicy(
  origin: string | undefined,
  port: number,
  additionalOrigins: string[] = [],
) {
  const publicOrigin = origin ? new URL(origin).origin : undefined;
  if (publicOrigin && !publicOrigin.startsWith('https://'))
    throw new Error('PUBLIC_ORIGIN must use HTTPS');
  const allowedOrigins = new Set(
    publicOrigin ? [publicOrigin] : [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
  );
  for (const value of additionalOrigins) {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Hosted origins must use HTTPS');
    allowedOrigins.add(url.origin);
  }
  const hosts = new Set([...allowedOrigins].map((o) => new URL(o).hostname));
  if (!publicOrigin) hosts.add('[::1]');
  const guard: RequestHandler = (req, res, next) => {
    const hostHeader = req.get('host') ?? '';
    const validHost = /^(?:\[::1\]|[a-z0-9.-]+)(?::\d+)?$/i.test(hostHeader);
    const hostname = validHost ? new URL(`http://${hostHeader}`).hostname : '';
    if (!hosts.has(hostname) || (req.get('origin') && !allowedOrigins.has(req.get('origin')!))) {
      res.status(403).json({ error: 'Host or origin is not allowed for this workspace.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  return { hosted: !!publicOrigin, guard };
}

export const localControlMessage =
  'Agent execution, worker controls and server backups require the local application. Public hosting does not expose a shared personal workspace.';

export const localControlGuard: RequestHandler = (_req, res) => {
  res.status(403).json({ error: localControlMessage });
};
