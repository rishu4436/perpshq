export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export const intervals: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};
export interface Candle {
  market: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timeframe: Timeframe;
  source: string;
  fetchedAt: number;
  complete: boolean;
}
export interface Market {
  id: string;
  symbol: string;
  baseSymbol: string;
  poolAddress: `0x${string}`;
  marginBank: `0x${string}`;
  quoteToken: `0x${string}`;
  baseDecimals: number;
  quoteDecimals: number;
  tickSize: string;
  lotSize: string;
  minQuantity: string;
  maxLeverage?: number;
  markPrice?: number;
  markUpdatedAt?: number;
  fundingRate?: number;
  openInterest?: number;
  change24h?: number;
  volume24h?: number;
  error?: string;
}
export interface BookLevel {
  price: number;
  quantity: number;
}
export interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
  fetchedAt: number;
  source: string;
}
export interface Quality {
  source: string;
  fetchedAt: number;
  lastCandle?: number;
  count: number;
  gaps: number;
  discarded: number;
  stale: boolean;
  notes: string[];
}
export interface Zone {
  low: number;
  high: number;
  touches: number;
  lastSeen: number;
  strength: number;
  kind: 'support' | 'resistance';
}
export interface Analysis {
  values: Record<string, number | null>;
  trend: 'Bullish' | 'Bearish' | 'Mixed' | 'Unavailable';
  regime: string;
  structure: string;
  zones: Zone[];
  score: number;
  coverage: number;
  factors: { name: string; weight: number; value: number | null; reason: string }[];
  explanations: string[];
  scenarios: { bullish: string; bearish: string; neutral: string };
}
export interface MarketDetail {
  market: Market;
  candles: Candle[];
  quality: Quality;
  analysis: Analysis;
  book: OrderBook | null;
  bookError?: string;
  timeframes: Partial<
    Record<
      Timeframe,
      { trend: string; rsi: number | null; macd: number | null; structure: string; count: number }
    >
  >;
}
export interface PlanInput {
  marketId: string;
  side: 'long' | 'short';
  type: 'limit' | 'market';
  entry: string;
  stop: string;
  target: string;
  riskBudget: string;
  collateral: string;
  leverage: string;
  slippageBps: string;
  quantity?: string;
}
export interface Plan {
  input: PlanInput;
  quantity: string;
  rawQuantity: string;
  rawPrice: string;
  notional: string;
  margin: string;
  loss: string;
  gain: string;
  rr: string;
  warnings: string[];
  errors: string[];
}
export interface JournalEntry {
  id: string;
  createdAt: number;
  market: string;
  wallet?: string;
  thesis: string;
  tags: string[];
  emotion: string;
  review: string;
  plan?: Plan;
  transactionHash?: string;
}
export type OrderState =
  | 'draft'
  | 'validating'
  | 'ready'
  | 'signature'
  | 'broadcasting'
  | 'pending'
  | 'confirmed'
  | 'syncing'
  | 'resting'
  | 'partial'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'unknown';
export const NETWORK = {
  id: 50383,
  name: 'Somnia Hideki Testnet',
  rpc: 'https://api.hideki2.infra.testnet.somnia.network',
  ws: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
  indexer: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  explorer: 'https://smk-dev-markets-explorer-hideki-euw4-uzavbo36ra-ez.a.run.app',
} as const;
