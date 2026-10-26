import type { MarketDetail, Timeframe } from '../shared-types';
import type { AgentConfig } from './config';
export type AgentStatus =
  | 'configured'
  | 'simulating'
  | 'awaiting-authorization'
  | 'running'
  | 'paused'
  | 'disconnected'
  | 'recovering'
  | 'error'
  | 'emergency-stopped';
export type DecisionType =
  | 'NO_ACTION'
  | 'ENTRY_CANDIDATE'
  | 'EXIT_CANDIDATE'
  | 'REDUCE_CANDIDATE'
  | 'CANCEL_CANDIDATE'
  | 'PAUSE_REQUIRED'
  | 'DATA_UNAVAILABLE'
  | 'BLOCKED';
export interface AgentPosition {
  marketId: string;
  side: 'long' | 'short';
  quantity: string;
  entryPrice: string;
  notional: string;
  unrealizedPnl: string;
  stopPrice?: string;
  targetPrice?: string;
  source: 'paper' | 'chain';
}
export interface AgentOrder {
  orderId: string;
  marketId: string;
  owner: string;
  quantity: string;
  remaining: string;
  notional: string;
  agentId?: string;
}
export interface AgentAccount {
  source: 'paper' | 'chain';
  observedAt: number;
  equity: string;
  availableCollateral: string;
  totalExposure: string;
  marketExposure: string;
  positionCount: number;
  orders: AgentOrder[];
  positions: AgentPosition[];
  health: number | null;
  verifiedLeverage: number | null;
  sessionPnl: string | null;
  dailyPnl: string | null;
  historyComplete: boolean;
  exposureComplete?: boolean;
  gasSTT: string | null;
  permissions: { place: boolean; cancel: boolean; reduce: boolean; checkedAt: number } | null;
  errors: string[];
}
export interface AgentRuntime {
  controlGeneration?: number;
  emergencyLatched?: boolean;
  lastSignalKey?: string;
  lastActionAt?: number;
  lastFailureAt?: number;
  consecutiveFailures: number;
  transactionTimes: number[];
  unknownIntent: boolean;
  leaseValid: boolean;
  controlAvailable: boolean;
  cursor: number;
  blockCursor?: string;
  status: AgentStatus;
}
export interface AgentObservation {
  detail?: MarketDetail;
  frames?: Partial<Record<Timeframe, MarketDetail>>;
  account?: AgentAccount;
  chainId: number;
  block: string;
  indexerReliable: boolean;
  observedAt: number;
  error?: string;
  historical?: boolean;
}
export interface ProposedOrder {
  action: 'entry' | 'close-position' | 'reduce-position' | 'cancel-order';
  side: 'long' | 'short';
  quantity: string;
  rawQuantity: string;
  price: string;
  rawPrice: string;
  notional: string;
  estimatedLoss: string;
  orderType: 'IOC' | 'LIMIT';
  stopPrice?: string;
  targetPrice?: string;
  orderId?: string;
}
export interface RiskEvaluation {
  allowed: boolean;
  pause: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  limitations: string[];
}
export interface AgentDecision {
  id: string;
  agentId: string;
  configRevision: number;
  schemaVersion: 1;
  marketId: string;
  strategy: AgentConfig['strategy'];
  type: DecisionType;
  evaluatedAt: number;
  sourceTimestamps: {
    fetchedAt?: number;
    markUpdatedAt?: number;
    candleTime?: number;
    accountAt?: number;
    block: string;
  };
  matched: string[];
  failed: string[];
  indicators: Record<string, number | null>;
  rationale: string;
  risk: RiskEvaluation;
  proposal?: ProposedOrder;
  signalKey?: string;
  paperOutcome?: {
    equity: string;
    cash: string;
    drawdown: string;
    fillCount: number;
    fees: string;
    funding: string;
  };
  evidenceKind: 'paper-observation' | 'assisted-proposal' | 'historical';
}
