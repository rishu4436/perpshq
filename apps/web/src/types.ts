import type { Market, Analysis } from '../../../packages/shared-types';
export type Page =
  | 'Command Center'
  | 'Opportunity Scanner'
  | 'Market Intelligence'
  | 'Trade Planner'
  | 'Positions & Risk'
  | 'Portfolio Analytics'
  | 'Trade Journal'
  | 'Arena Companion'
  | 'Settings & Help';

export type ScanRow = {
  market: Market;
  analysis: Analysis;
  quality: { stale: boolean; count: number };
  error?: string;
};

export type AlertRule = {
  id: string;
  marketId: string;
  symbol: string;
  type: 'price-above' | 'price-below' | 'rsi-above' | 'atr-above' | 'margin-below';
  threshold: number;
  enabled: boolean;
  triggered?: boolean;
  checkedAt?: number;
};

export type AlertEvent = { id: string; text: string; time: number };
