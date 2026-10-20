import Decimal from 'decimal.js';
import { account, detail, markets, rpc, sdk, marketById } from '../../../packages/dreamdex-adapter';
import { readPermissions } from '../../../packages/agent-execution';
import { fromRaw } from '../../../packages/risk-engine';
import type { AgentConfig } from '../../../packages/agent-engine/config';
import type { AgentObservation, AgentAccount } from '../../../packages/agent-engine/types';
export async function verifyWorkerNetwork() {
  if ((await rpc.getChainId()) !== 50383)
    throw new Error('Agent worker requires Hideki chain 50383');
  if (!(await markets()).length)
    throw new Error('No supported Hideki perpetual markets discovered');
}
export async function observeAgent(c: AgentConfig): Promise<AgentObservation> {
  const [chainId, block, primary, freshness] = await Promise.all([
    rpc.getChainId(),
    rpc.getBlockNumber(),
    detail(c.marketId, c.timeframes[0]),
    sdk.client.getIndexerFreshness(50383),
  ]);
  const frames: NonNullable<AgentObservation['frames']> = { [c.timeframes[0]]: primary };
  for (const tf of c.timeframes.slice(1)) frames[tf] = await detail(c.marketId, tf);
  let chainAccount: AgentAccount | undefined;
  if (c.ownerAddress) {
    const m = await marketById(c.marketId),
      a = await account(c.ownerAddress as `0x${string}`),
      constraints = await sdk.client.getPerpMaxLeverage({
        pool: m.poolAddress,
        marginBank: m.marginBank,
        account: c.ownerAddress as `0x${string}`,
      });
    const permissions = c.operatorAddress ? await readPermissions(c, m) : null;
    const errors = [...a.errors];
    if (!a.positions || !a.orders || !a.analytics || !a.margin)
      errors.push('Incomplete account/position/order/margin observation');
    const allMarkets = await markets();
    const positions = (a.analytics ?? []).flatMap((p) => {
      const market = allMarkets.find((m) => m.id.toLowerCase() === p.pool.toLowerCase()),
        source = (a.positions ?? []).find((v) => v.pool.toLowerCase() === p.pool.toLowerCase());
      if (
        !market ||
        !source ||
        !p.priceable ||
        source.entryPriceX18 === null ||
        p.notional == null ||
        p.unrealizedPnl == null
      ) {
        errors.push('An account position cannot be priced reliably');
        return [];
      }
      const size = new Decimal(fromRaw(p.size, market.baseDecimals));
      if (size.isZero()) return [];
      return [
        {
          marketId: market.id,
          side: size.gt(0) ? ('long' as const) : ('short' as const),
          quantity: size.abs().toFixed(),
          entryPrice: fromRaw(source.entryPriceX18, 18),
          notional: fromRaw(p.notional, market.quoteDecimals),
          unrealizedPnl: fromRaw(p.unrealizedPnl, market.quoteDecimals),
          source: 'chain' as const,
        },
      ];
    });
    const orders = (a.orders ?? [])
      .filter((o) => o.status === 'Open')
      .flatMap((o) => {
        const market = allMarkets.find((m) => m.id.toLowerCase() === o.pool.toLowerCase());
        if (!market) {
          errors.push('An open order has unknown market constraints');
          return [];
        }
        const remaining = fromRaw(o.quantityRemaining, market.baseDecimals),
          price = fromRaw(o.price, market.quoteDecimals);
        return [
          {
            orderId: o.orderId,
            marketId: market.id,
            owner: c.ownerAddress!,
            quantity: fromRaw(o.fullQuantity, market.baseDecimals),
            remaining,
            notional: new Decimal(remaining).mul(price).toFixed(),
          },
        ];
      });
    const total = positions
      .reduce((sum, p) => sum.plus(p.notional), new Decimal(0))
      .plus(orders.reduce((sum, o) => sum.plus(o.notional), new Decimal(0)));
    const market = positions
      .filter((p) => p.marketId.toLowerCase() === m.id.toLowerCase())
      .reduce((sum, p) => sum.plus(p.notional), new Decimal(0))
      .plus(
        orders
          .filter((o) => o.marketId.toLowerCase() === m.id.toLowerCase())
          .reduce((sum, o) => sum.plus(o.notional), new Decimal(0)),
      );
    const equity = a.margin ? fromRaw(a.margin.equity, a.quoteDecimals) : '0',
      maintenance = a.margin
        ? new Decimal(fromRaw(a.margin.mmReq, a.quoteDecimals))
        : new Decimal(0);
    chainAccount = {
      source: 'chain',
      observedAt: a.fetchedAt,
      equity,
      availableCollateral: a.margin
        ? fromRaw(a.margin.unlockedCollateralBalance, a.quoteDecimals)
        : '0',
      totalExposure: total.toFixed(),
      marketExposure: market.toFixed(),
      positionCount: positions.length,
      positions,
      orders,
      health: a.margin
        ? maintenance.gt(0)
          ? new Decimal(equity).div(maintenance).toNumber()
          : new Decimal(equity).gt(0)
            ? 100
            : null
        : null,
      verifiedLeverage:
        constraints === 0
          ? (m.maxLeverage ?? null)
          : Math.min(constraints, m.maxLeverage ?? constraints),
      sessionPnl: null,
      dailyPnl: null,
      historyComplete: false,
      gasSTT: permissions?.gasSTT ?? null,
      permissions: permissions
        ? {
            place: permissions.place,
            cancel: permissions.cancel,
            reduce: permissions.reduce,
            checkedAt: permissions.checkedAt,
          }
        : null,
      errors,
    };
  }
  return {
    detail: primary,
    frames,
    account: chainAccount,
    chainId,
    block: block.toString(),
    indexerReliable:
      !!freshness &&
      freshness.lagSeconds !== null &&
      freshness.lagSeconds <= BigInt(c.risk.maxDataAgeSeconds),
    observedAt: Date.now(),
  };
}
