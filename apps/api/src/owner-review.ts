import Decimal from 'decimal.js';
import {
  evaluateAgent,
  type AgentConfig,
  type AgentDecision,
  type ProposedOrder,
  type AgentRuntime,
} from '../../../packages/agent-engine';
import { assessRisk, sizeProposal } from '../../../packages/agent-risk';
import { observeAgent } from '../../agent-worker/src/live-data';
import { marketById, prepare, prepareCancel } from '../../../packages/dreamdex-adapter';
import { planTrade } from '../../../packages/risk-engine';
import type { TransactionPreview } from '../../../packages/trade-planner/approval';
import type { AccountingCheckpointCache } from '../../../packages/accounting';
export type Ticket = {
  id: string;
  config: AgentConfig;
  decision: AgentDecision;
  proposal?: ProposedOrder;
  preview: TransactionPreview;
  referenceMark?: number;
  expiresAt: number;
};
export async function prepareOwnerReview(
  config: AgentConfig,
  previous: Ticket | undefined,
  runtime: () => AgentRuntime,
  checkpoints?: AccountingCheckpointCache,
) {
  if (
    config.mode !== 'ASSISTED' ||
    config.execution.signer !== 'owner-wallet' ||
    !config.ownerAddress ||
    config.operatorAddress
  )
    throw new Error(
      'An assisted owner-wallet configuration without a delegated operator is required',
    );
  let observation = await observeAgent(
    config,
    Math.floor(Date.now() / 86400000) * 86400000,
    checkpoints,
  );
  if (
    Date.now() - (observation.account?.observedAt ?? 0) > config.risk.maxDataAgeSeconds * 500 ||
    Date.now() - (observation.detail?.quality.fetchedAt ?? 0) > config.risk.maxDataAgeSeconds * 500
  )
    observation = await observeAgent(
      config,
      Math.floor(Date.now() / 86400000) * 86400000,
      checkpoints,
    );
  const d = evaluateAgent(config, observation, runtime(), Date.now());
  const diagnostics = {
    accountErrors: observation.account?.errors,
    historyComplete: observation.account?.historyComplete,
    accountAt: observation.account?.observedAt,
    observedAt: observation.observedAt,
  };
  if (runtime().unknownIntent)
    throw new Error(
      'An owner-wallet submission has an unknown outcome; reconcile it before another review',
    );
  let p = d.proposal;
  if (
    previous &&
    (d.type !== previous.decision.type ||
      p?.side !== previous.proposal?.side ||
      p?.action !== previous.proposal?.action)
  )
    throw new Error('Strategy decision changed. Review again.');
  if (
    d.type === 'CANCEL_CANDIDATE' &&
    config.strategy === 'risk-guardian' &&
    config.execution.allowRestingCancellations
  ) {
    const account = observation.account;
    if (
      !account ||
      account.errors.length ||
      !account.exposureComplete ||
      !Number.isFinite(account.observedAt) ||
      account.observedAt > Date.now() + 1000 ||
      Date.now() - account.observedAt > config.risk.maxDataAgeSeconds * 1000
    )
      throw new Error('A fresh reconciled owner account is required for cancellation');
    const order = observation.account?.orders.find(
      (o) =>
        o.marketId.toLowerCase() === config.marketId.toLowerCase() &&
        o.owner.toLowerCase() === config.ownerAddress!.toLowerCase() &&
        (!previous || o.orderId === previous.preview.orderId),
    );
    if (!order) throw new Error('No matching owned resting order remains');
    return {
      decision: d,
      preview: await prepareCancel(
        config.marketId,
        order.orderId,
        config.ownerAddress as `0x${string}`,
      ),
    };
  }
  if (d.type !== 'ENTRY_CANDIDATE' || !d.risk.allowed || !p) return { decision: d, diagnostics };
  if (!observation.account?.historyComplete)
    throw new Error('Complete session/day bank accounting is required');
  if (previous?.proposal) {
    if (new Decimal(previous.proposal.quantity).gt(p.quantity))
      throw new Error('Fresh strategy sizing fell below the reviewed quantity');
    const prior = previous.proposal;
    const mark = new Decimal(observation.detail!.market.markPrice!);
    if (!previous.referenceMark)
      throw new Error('Review the strategy again to capture its reference mark');
    if (
      new Decimal(previous.referenceMark)
        .minus(mark)
        .abs()
        .div(previous.referenceMark)
        .mul(10000)
        .gt(config.risk.maxSlippageBps)
    )
      throw new Error('Reviewed execution bound is outside current slippage policy');
    const freshSizing = sizeProposal(
      config,
      observation.detail!.market,
      prior.side,
      prior.quantity,
    );
    p = {
      ...prior,
      estimatedLoss: freshSizing.estimatedLoss,
      stopPrice: freshSizing.stopPrice,
      targetPrice: freshSizing.targetPrice,
    };
    const risk = assessRisk(config, observation, runtime(), p, Date.now());
    if (!risk.allowed)
      throw new Error(
        'Reviewed quantity no longer passes risk: ' +
          risk.checks
            .filter((c) => !c.passed)
            .map((c) => c.name)
            .join(', '),
      );
  }
  const m = await marketById(config.marketId);
  const plan = planTrade(
    {
      marketId: m.id,
      side: p.side,
      type: 'market',
      entry: p.price,
      stop: p.stopPrice!,
      target: p.targetPrice!,
      riskBudget: config.risk.riskBudget,
      collateral: observation.account.availableCollateral,
      leverage: String(config.risk.leverage),
      slippageBps: '0',
      quantity: p.quantity,
    },
    m,
  );
  if (plan.rawQuantity !== p.rawQuantity || plan.rawPrice !== p.rawPrice)
    throw new Error('Plan does not match exact strategy sizing');
  const preview = await prepare(plan, config.ownerAddress as `0x${string}`, previous?.preview.data);
  if (
    previous &&
    preview.estimatedGasUnits &&
    BigInt(preview.estimatedGasUnits) * 110n <= BigInt(previous.preview.gas) * 100n
  ) {
    // Keep the approved fee ceiling when a refreshed estimate fits with 10% headroom.
    preview.gas = previous.preview.gas;
    preview.estimatedGasSTT = new Decimal(preview.gas).mul(preview.gasPrice!).div('1e18').toFixed();
  }
  return {
    decision: d,
    proposal: p,
    preview,
    referenceMark: previous?.referenceMark ?? observation.detail!.market.markPrice,
  };
}
