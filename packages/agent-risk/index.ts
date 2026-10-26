import Decimal from 'decimal.js';
import type { Market } from '../shared-types';
import type { AgentConfig } from '../agent-engine/config';
import type {
  AgentObservation,
  AgentRuntime,
  ProposedOrder,
  RiskEvaluation,
} from '../agent-engine/types';
import { fromRaw } from '../risk-engine';

export function sizeProposal(
  config: AgentConfig,
  market: Market,
  side: 'long' | 'short',
  quantityOverride?: string,
  action: ProposedOrder['action'] = 'entry',
): ProposedOrder {
  if (!market.markPrice || !Number.isFinite(market.markPrice) || market.markPrice <= 0)
    throw new Error('A valid mark is required for sizing');
  const tick = new Decimal(fromRaw(market.tickSize, market.quoteDecimals)),
    lot = new Decimal(market.lotSize);
  if (tick.lte(0) || lot.lte(0) || BigInt(market.minQuantity) <= 0n)
    throw new Error('Missing market increments');
  const mark = new Decimal(market.markPrice),
    direction = side === 'long' ? 1 : -1;
  const ioc = action !== 'entry' || config.execution.orderType === 'IOC';
  const adjustment =
    (ioc ? config.risk.maxSlippageBps : -config.execution.limitOffsetBps) * direction;
  const bound = mark.mul(new Decimal(1).plus(new Decimal(adjustment).div(10000)));
  const units = side === 'long' ? bound.div(tick).floor() : bound.div(tick).ceil();
  const price = units.mul(tick),
    stop = mark.mul(
      new Decimal(1).minus(new Decimal(config.execution.stopLossPct).div(100).mul(direction)),
    );
  const target = mark.mul(
    new Decimal(1).plus(new Decimal(config.execution.takeProfitPct).div(100).mul(direction)),
  );
  const adverse = mark.plus(stop).mul(config.risk.maxSlippageBps).div(10000),
    fees = mark.plus(stop).mul(config.paper.feeBps).div(10000);
  const lossPerUnit = mark.minus(stop).abs().plus(adverse).plus(fees);
  const wanted = quantityOverride
    ? new Decimal(quantityOverride)
    : Decimal.min(
        new Decimal(config.risk.orderNotional).div(price),
        new Decimal(config.risk.riskBudget).div(lossPerUnit),
      );
  const raw = wanted.mul(new Decimal(10).pow(market.baseDecimals)).div(lot).floor().mul(lot);
  if (!raw.isFinite() || raw.lt(market.minQuantity))
    throw new Error('Sizing is below the verified minimum quantity');
  const quantity = raw.div(new Decimal(10).pow(market.baseDecimals));
  return {
    action,
    side,
    quantity: quantity.toFixed(),
    rawQuantity: raw.toFixed(0),
    price: price.toFixed(),
    rawPrice: price.mul(new Decimal(10).pow(market.quoteDecimals)).toFixed(0),
    notional: quantity.mul(price).toFixed(),
    estimatedLoss: quantity.mul(lossPerUnit).toFixed(),
    orderType: ioc ? 'IOC' : 'LIMIT',
    ...(action === 'entry' ? { stopPrice: stop.toFixed(), targetPrice: target.toFixed() } : {}),
  };
}

export function assessRisk(
  config: AgentConfig,
  observation: AgentObservation,
  runtime: AgentRuntime,
  proposal: ProposedOrder,
  now: number,
): RiskEvaluation {
  const checks: RiskEvaluation['checks'] = [],
    limitations: string[] = [];
  const check = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });
  const m = observation.detail?.market,
    a = observation.account,
    increasing = proposal.action === 'entry';
  const numeric = (v: string | null | undefined) => {
    try {
      const d = new Decimal(v ?? 'NaN');
      return d.isFinite() ? d : null;
    } catch {
      return null;
    }
  };
  const atMost = (v: string | null | undefined, limit: string) =>
    !!numeric(v) && numeric(v)!.lte(limit);
  check(
    'Hideki identity',
    observation.chainId === 50383 && config.chainId === 50383,
    'Only chain 50383 is supported',
  );
  check(
    'Durable ownership',
    runtime.leaseValid && runtime.controlAvailable,
    'A current fenced lease and local control store are required',
  );
  check(
    'Known submission outcome',
    !runtime.unknownIntent,
    'Unresolved intent prevents new proposals',
  );
  check(
    'Indexer synchronized',
    observation.indexerReliable,
    'Unreliable chain/indexer observations require a pause',
  );
  check(
    'Fresh observation',
    now - observation.observedAt <= config.risk.maxDataAgeSeconds * 1000 &&
      observation.observedAt <= now + 1000,
    'Observation age must fit the configured bound',
  );
  const markAt = m?.markUpdatedAt ?? 0;
  check(
    'Fresh valid mark',
    !!m &&
      !m.error &&
      !!m.markPrice &&
      Number.isFinite(m.markPrice) &&
      markAt > 0 &&
      now - markAt <= config.risk.maxDataAgeSeconds * 1000 &&
      markAt <= now + 1000,
    'Never use a missing, future or stale mark',
  );
  check(
    'Account reconciled',
    !!a &&
      a.errors.length === 0 &&
      now - a.observedAt <= config.risk.maxDataAgeSeconds * 1000 &&
      a.observedAt <= now + 1000,
    'Account errors and stale snapshots fail closed',
  );
  if (m) {
    let increments = false;
    try {
      increments =
        BigInt(proposal.rawQuantity) >= BigInt(m.minQuantity) &&
        BigInt(proposal.rawQuantity) % BigInt(m.lotSize) === 0n &&
        BigInt(proposal.rawPrice) > 0n &&
        BigInt(proposal.rawPrice) % BigInt(m.tickSize) === 0n;
    } catch {
      /* Missing or malformed constraints fail below. */
    }
    check(
      'Market increments',
      increments && m.id.toLowerCase() === config.marketId.toLowerCase(),
      'Quantity/price must respect discovered pool decimals, lot, tick and minimum',
    );
    let integrity = false;
    try {
      const quantity = new Decimal(fromRaw(proposal.rawQuantity, m.baseDecimals)),
        price = new Decimal(fromRaw(proposal.rawPrice, m.quoteDecimals)),
        mark = new Decimal(m.markPrice ?? 0);
      const stop = mark.mul(
        new Decimal(1).plus(
          new Decimal(config.execution.stopLossPct).div(100).mul(proposal.side === 'long' ? -1 : 1),
        ),
      );
      const perUnit = mark
        .minus(stop)
        .abs()
        .plus(
          mark
            .plus(stop)
            .mul(config.risk.maxSlippageBps + config.paper.feeBps)
            .div(10000),
        );
      integrity =
        quantity.gt(0) &&
        price.gt(0) &&
        quantity.eq(proposal.quantity) &&
        price.eq(proposal.price) &&
        quantity.mul(price).eq(proposal.notional) &&
        (!increasing ||
          (!!proposal.stopPrice &&
            stop.eq(proposal.stopPrice) &&
            quantity.mul(perUnit).eq(proposal.estimatedLoss)));
    } catch {
      /* Strategies cannot make a smaller claimed notional bypass policy. */
    }
    check(
      'Sizing integrity',
      integrity,
      'Recompute quantity, price, notional and risk from exact raw units; never trust claimed sizing',
    );
    check(
      'Planning leverage',
      config.risk.leverage <= (m.maxLeverage ?? 0),
      'Planning leverage cannot exceed discovered market maximum',
    );
  } else check('Market discovered', false, 'A discovered supported perpetual pool is required');
  check(
    'Failure breaker',
    runtime.consecutiveFailures < config.risk.maxRepeatedFailures,
    'Repeated failures require a pause',
  );
  check(
    'Failure cooldown',
    !runtime.lastFailureAt ||
      now - runtime.lastFailureAt >= config.risk.failureCooldownSeconds * 1000,
    'Do not immediately retry a failed/unknown transaction',
  );
  check(
    'Transaction rate',
    runtime.transactionTimes.filter((t) => t > now - 3600000 && t <= now).length <
      config.risk.maxTransactionsPerHour,
    'Hourly count includes persisted attempts',
  );
  check(
    'Action cooldown',
    !runtime.lastActionAt || now - runtime.lastActionAt >= config.risk.cooldownSeconds * 1000,
    'Respect cooldown between actions',
  );
  check(
    'Slippage cap',
    config.paper.slippageBps <= config.risk.maxSlippageBps &&
      config.execution.limitOffsetBps <= config.risk.maxSlippageBps,
    'Execution constraints cannot exceed the policy cap',
  );
  if (a) {
    check(
      'Exposure complete',
      a.source === 'paper' || a.exposureComplete === true,
      'Risk requires authoritative current orders and active bank positions, not a bounded history page',
    );
    const paper = config.mode === 'DRY_RUN' && a.source === 'paper';
    check(
      'Account source',
      paper || a.source === 'chain',
      'Assisted proposals require real chain/account observations',
    );
    if (paper)
      limitations.push(
        'Paper cash/leverage are simulation assumptions. No actual permissions, STT or protocol sizing are implied.',
      );
    else {
      const p = a.permissions;
      check(
        'Operator permission',
        !!p &&
          now - p.checkedAt <= 30000 &&
          p.checkedAt <= now &&
          p.place &&
          p.cancel &&
          (proposal.action === 'entry' || config.execution.allowPositionReductions),
        'Fresh action policy and market-specific operator permissions are required',
      );
      const gas = numeric(a.gasSTT);
      check(
        'Operator STT reserve',
        !!gas && gas.gte(config.risk.minGasReserveSTT),
        'Missing balance is not zero or sufficient gas',
      );
      check(
        'Verified leverage',
        a.verifiedLeverage !== null && config.risk.leverage <= a.verifiedLeverage,
        'The account leverage setting must be verified; this system never changes it',
      );
      check(
        'Account health',
        !increasing || (a.health !== null && a.health >= config.risk.minHealth),
        'Missing actual account health cannot authorize a trade',
      );
    }
    if (increasing) {
      check(
        'Per-order notional',
        atMost(proposal.notional, config.risk.maxOrderNotional),
        'Include proposed size in the per-order cap',
      );
      check(
        'Per-trade risk',
        atMost(proposal.estimatedLoss, config.risk.riskBudget),
        'Estimated stop loss, slippage and configured fees must fit the budget; actual stops are not armed',
      );
      const total = numeric(a.totalExposure),
        market = numeric(a.marketExposure),
        notional = numeric(proposal.notional);
      check(
        'Total exposure',
        !!total && !!notional && total.plus(notional).lte(config.risk.maxTotalExposure),
        'Include positions and remaining order notional across the account',
      );
      check(
        'Market exposure',
        !!market && !!notional && market.plus(notional).lte(config.risk.maxMarketExposure),
        'Include remaining orders and the proposed market exposure',
      );
      check(
        'Open positions',
        a.positionCount < config.risk.maxOpenPositions,
        'No new entry at the position cap',
      );
      check(
        'Open orders',
        a.orders.length < config.risk.maxOpenOrders,
        'No new entry at the open-order cap',
      );
      const collateral = numeric(a.availableCollateral);
      check(
        'Available collateral',
        !!collateral && !!notional && notional.div(config.risk.leverage).lte(collateral),
        'Planning margin must fit usable collateral; actual protocol sizing is still mandatory',
      );
      const session = numeric(a.sessionPnl),
        daily = numeric(a.dailyPnl);
      check(
        'Loss history complete',
        a.historyComplete && !!session && !!daily,
        'Incomplete P&L blocks risk-increasing proposals; missing P&L is never treated as zero',
      );
      check(
        'Session loss',
        !!session && session.gt(new Decimal(config.risk.maxSessionLoss).neg()),
        'Pause at or beyond the session loss guard',
      );
      check(
        'Daily loss',
        !!daily && daily.gt(new Decimal(config.risk.maxDailyLoss).neg()),
        'Pause at or beyond the UTC-day loss guard',
      );
    } else if (proposal.action === 'close-position' || proposal.action === 'reduce-position') {
      const position = a.positions.find(
        (p) => p.marketId.toLowerCase() === config.marketId.toLowerCase(),
      );
      check(
        'Position reduction size',
        !!position &&
          position.side !== proposal.side &&
          new Decimal(proposal.quantity).lte(position.quantity),
        'An opposite-side proposal may never exceed the freshly observed position',
      );
      limitations.push(
        'An opposite-side IOC is not an atomic reduce-only position close. Actual broadcast remains disabled.',
      );
    }
  }
  const failed = checks.filter((c) => !c.passed);
  const pauseNames = [
    'Exposure complete',
    'Durable ownership',
    'Known submission outcome',
    'Indexer synchronized',
    'Fresh observation',
    'Fresh valid mark',
    'Account reconciled',
    'Failure breaker',
    'Operator permission',
    'Operator STT reserve',
    'Account health',
    'Loss history complete',
    'Session loss',
    'Daily loss',
  ];
  return {
    allowed: failed.length === 0,
    pause: failed.some((c) => pauseNames.includes(c.name)),
    checks,
    limitations,
  };
}
