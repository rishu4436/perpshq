import { type ReactNode } from 'react';
import { Eye, Activity } from 'lucide-react';
import { type Market } from '../../../../packages/shared-types';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>;
}

export function Empty({
  icon: Icon = Eye,
  title,
  children,
  action,
}: {
  icon?: typeof Eye;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return error ? (
    <div className="notice danger" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}

export function Coin({ market }: { market: Market }) {
  return (
    <span className={'coin ' + market.baseSymbol.toLowerCase()}>
      {({ BTC: '₿', ETH: 'Ξ', SOL: '◎', HYPE: 'H' } as Record<string, string>)[market.baseSymbol] ??
        market.baseSymbol.slice(0, 1)}
    </span>
  );
}

export function Skeleton() {
  return (
    <div className="skeletons" aria-label="Loading market data">
      {[1, 2, 3, 4, 5].map((i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon: Icon = Activity,
  tone = '',
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon?: typeof Activity;
  tone?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        <Icon size={15} />
      </div>
      <strong className={tone}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
