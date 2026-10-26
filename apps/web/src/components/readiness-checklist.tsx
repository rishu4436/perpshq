import { useEffect, useState } from 'react';
import { CheckCircle2, Shield, TriangleAlert } from 'lucide-react';
import type { Market } from '../../../../packages/shared-types';
import { tradingReadiness } from '../../../../packages/trade-planner/readiness';
import type { AccountData } from '../lib';
import type { useWallet } from '../wallet';
import { Badge } from './ui';
import './recovery-center.css';
export function ReadinessChecklist({
  wallet,
  account,
  market,
  planErrors,
}: {
  wallet: ReturnType<typeof useWallet>;
  account?: AccountData;
  market?: Market;
  planErrors?: string[];
}) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const checks = tradingReadiness({
    address: wallet.address,
    chain: wallet.chain,
    account,
    market,
    unresolved: !!wallet.submission,
    planErrors,
    now: clock,
  });
  return (
    <section className="panel readiness">
      <div className="panel-head">
        <h3>
          <Shield size={16} /> Trading readiness
        </h3>
        <Badge>
          {checks.filter((c) => c.passed).length}/{checks.length} CHECKS
        </Badge>
      </div>
      <div className="readiness-grid">
        {checks.map((c) => (
          <div key={c.name} className={c.passed ? 'ready-check' : 'blocked-check'}>
            {c.passed ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
            <div>
              <strong>{c.name}</strong>
              <p>{c.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="control-footnote">
        Readiness is a planning check. The final preview and wallet approval apply to one exact
        order. Planned stops are not armed protective orders.
      </p>
    </section>
  );
}
