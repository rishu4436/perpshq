import type { AgentRuntime } from './types';
/** Persist attempts, including unfilled proposals, consistently in historical and forward runs. */
export function recordAction(runtime: AgentRuntime, at: number) {
  runtime.lastActionAt = at;
  runtime.transactionTimes = [
    ...runtime.transactionTimes.filter((t) => t > at - 3600000 && t <= at),
    at,
  ];
}
