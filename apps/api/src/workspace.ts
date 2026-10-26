import { activitySchema } from '../../../packages/workspace/validation';
import { Router } from 'express';
import { z } from 'zod';
import type { AgentStore } from '../../../packages/agent-store';
import {
  recovery,
  inbox,
  acknowledgeAlert,
  lifecycle,
  savePortfolio,
  portfolioViews,
  replays,
  compareReplay,
  exportWorkspace,
  restoreWorkspace,
  records,
  putRecord,
  condition,
  packBackup,
  unpackBackup,
} from '../../../packages/workspace';
import { accountPerformance } from '../../../packages/dreamdex-adapter/accounting';
import type { Address } from 'viem';
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
export function createWorkspaceRouter(store: AgentStore | undefined) {
  const r = Router();
  const route = (
    method: 'get' | 'post',
    path: string,
    fn: (s: AgentStore, req: import('express').Request) => unknown,
  ) =>
    r[method](path, async (req, res) => {
      if (!store) {
        res.status(503).json({ error: 'Local workspace database unavailable' });
        return;
      }
      try {
        res.json(await fn(store, req));
      } catch (e) {
        res
          .status(e instanceof z.ZodError ? 400 : 422)
          .json({ error: e instanceof Error ? e.message : 'Workspace request failed' });
      }
    });
  route('get', '/', (s) => ({
    recovery: recovery(s),
    alerts: inbox(s),
    portfolios: portfolioViews(s),
    archived: s
      .list(true)
      .filter((a) => a.archivedAt)
      .map((a) => ({ id: a.config.id, name: a.config.name })),
    activities: records(s, 'activity').slice(0, 1000),
    accounting: records(s, 'accounting').slice(0, 20),
  }));
  route('post', '/alerts/:id/acknowledge', (s, req) =>
    acknowledgeAlert(s, z.string().uuid().parse(req.params.id)),
  );
  route('post', '/agents/:id/lifecycle', (s, req) =>
    lifecycle(
      s,
      z.string().uuid().parse(req.params.id),
      z
        .object({ action: z.enum(['archive', 'restore', 'clone']) })
        .strict()
        .parse(req.body).action,
    ),
  );
  route('post', '/portfolios', (s, req) => savePortfolio(s, req.body));
  route('get', '/backup', (s) => packBackup(exportWorkspace(s)));
  route('post', '/restore', (s, req) => restoreWorkspace(s, unpackBackup(req.body)));
  route('get', '/agents/:id/replays', (s, req) =>
    replays(s, z.string().uuid().parse(req.params.id)),
  );
  route('post', '/agents/:id/compare', (s, req) =>
    compareReplay(
      s,
      z.string().uuid().parse(req.params.id),
      z
        .object({ decisionId: z.string().max(200) })
        .strict()
        .parse(req.body).decisionId,
    ),
  );
  route('post', '/activity', (s, req) => {
    const a = activitySchema.parse(req.body);
    if (a.at > Date.now() + 300000) throw new Error('Activity timestamp is in the future');
    if (
      !records<{ id: string; hash?: string; state: string }>(s, 'activity').some(
        (v) => v.id === a.id || (a.hash && v.hash === a.hash && v.state === a.state),
      )
    )
      s.transaction(() => {
        putRecord(s, 'activity', a.id, { ...a, source: 'browser-reported' });
        if (a.hash)
          condition(s, 'order:' + a.hash + ':' + a.state, true, {
            severity: a.state === 'unknown' ? 'critical' : 'info',
            title: 'Order ' + a.state,
            detail: a.detail,
          });
      });
    return { saved: true };
  });
  route('post', '/accounting', async (s, req) => {
    const b = z
      .object({ account: address, marketId: address, since: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    if (Date.now() - b.since > 7 * 86400000)
      throw new Error('Reconcile at most seven days per report');
    const report = await accountPerformance(b.account as Address, b.marketId, b.since);
    putRecord(s, 'accounting', b.account.toLowerCase() + ':' + report.from.block, report);
    return report;
  });
  return r;
}
