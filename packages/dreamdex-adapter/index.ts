import {
  SomniaMarkets,
  SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  perpPoolWriteAbi,
  orderBookEventsAbi,
  type PerpMarket,
} from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionData,
  decodeEventLog,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import {
  NETWORK,
  intervals,
  type Market,
  type Candle,
  type Timeframe,
  type OrderBook,
  type MarketDetail,
  type Plan,
} from '../shared-types';
import { AsyncCache, normalizeCandles, aggregateCandles } from '../market-data';
import { fromRaw } from '../risk-engine';
import { analyze } from '../opportunity-scoring';
import Decimal from 'decimal.js';
import { orderOutcome } from '../trade-planner/evidence';
import { verifyExposure } from './exposure';

export const sdk = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: NETWORK.indexer,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  indexerLimits: { maxInFlight: 4, maxAttempts: 2 },
});
export const rpc = createPublicClient({
  chain: hidekiTestnet,
  transport: http(NETWORK.rpc, { timeout: 12000, retryCount: 1 }),
});
const marketCache = new AsyncCache<Market[]>(15000),
  candleCache = new AsyncCache<ReturnType<typeof normalizeCandles>>(20000),
  detailCache = new AsyncCache<MarketDetail>(15000);
export const human = (v: string | bigint | null | undefined, dp: number) =>
  v === null || v === undefined ? undefined : Number(fromRaw(v, dp));
export function normalizeMarket(m: PerpMarket): Market {
  return {
    id: m.id,
    symbol: `${m.baseSymbol ?? 'Unknown'}-PERP`,
    baseSymbol: m.baseSymbol ?? 'Unknown',
    poolAddress: m.poolAddress,
    marginBank: m.marginBank,
    quoteToken: m.quoteToken,
    baseDecimals: m.baseDecimals,
    quoteDecimals: m.quoteDecimals,
    tickSize: m.tickSize,
    lotSize: m.lotSize,
    minQuantity: m.minQuantity,
    maxLeverage: m.initialMarginBps > 0 ? 10000 / m.initialMarginBps : undefined,
    markPrice: human(m.markPrice, m.quoteDecimals),
    markUpdatedAt: m.markPriceUpdatedAt ? Number(m.markPriceUpdatedAt) * 1000 : undefined,
    fundingRate:
      m.fundingRate && m.fundingWindowSec
        ? (human(m.fundingRate, 18)! * 3600) / m.fundingWindowSec
        : undefined,
    openInterest: human(m.openInterest, m.baseDecimals),
  };
}
export async function markets() {
  return marketCache.get('markets', async () => {
    const rows = await sdk.client.listPerpMarkets();
    return rows.map(normalizeMarket).sort((a, b) => {
      const priority = ['BTC', 'ETH', 'SOL', 'HYPE'];
      return (
        (priority.indexOf(a.baseSymbol) < 0 ? 100 : priority.indexOf(a.baseSymbol)) -
          (priority.indexOf(b.baseSymbol) < 0 ? 100 : priority.indexOf(b.baseSymbol)) ||
        a.symbol.localeCompare(b.symbol)
      );
    });
  });
}
export async function marketById(id: string) {
  const m = (await markets()).find((m) => m.id.toLowerCase() === id.toLowerCase());
  if (!m) throw new Error('Unknown Hideki perpetual pool. Refresh market discovery.');
  return m;
}
export async function candles(m: Market, tf: Timeframe) {
  return candleCache.get(m.id + tf, async () => {
    const now = Date.now(),
      step = intervals[tf];
    const rows = await sdk.client.getCandles(m.poolAddress, step, { market: m.id, limit: 500 });
    let data: Candle[] = rows.map((v) => ({
      market: m.id,
      time: Number(v.bucketStart),
      open: human(v.openPrice, m.quoteDecimals)!,
      high: human(v.high, m.quoteDecimals)!,
      low: human(v.low, m.quoteDecimals)!,
      close: human(v.closePrice, m.quoteDecimals)!,
      volume: human(v.baseVolume, m.baseDecimals),
      timeframe: tf,
      source: 'dreamDEX Hideki perpetual fills · SDK indexer',
      fetchedAt: now,
      complete: Number(v.bucketStart) + step <= now / 1000,
    }));
    if (!rows.length && tf === '4h') {
      const base = await candles(m, '1h');
      data = aggregateCandles(base.candles, '4h');
    }
    return normalizeCandles(data, tf, now);
  });
}
export async function book(m: Market): Promise<OrderBook> {
  const b = await sdk.client.getSpotOrderBook(m.poolAddress, { depth: 20 });
  const convert = (levels: typeof b.bids) =>
    levels.map((v) => ({
      price: human(v.price, m.quoteDecimals)!,
      quantity: human(v.quantity, m.baseDecimals)!,
    }));
  return {
    bids: convert(b.bids).sort((a, b) => b.price - a.price),
    asks: convert(b.asks).sort((a, b) => a.price - b.price),
    fetchedAt: Date.now(),
    source: 'Hideki PerpPool · on-chain resting depth (fillable size may differ)',
  };
}
export async function detail(id: string, tf: Timeframe): Promise<MarketDetail> {
  return detailCache.get(id + tf, async () => {
    let m = await marketById(id);
    const [history, ob, state] = await Promise.allSettled([
      candles(m, tf),
      book(m),
      sdk.client.getPerpState(m.poolAddress),
    ]);
    if (history.status === 'rejected') throw history.reason;
    if (state.status === 'fulfilled') {
      const s = state.value;
      m = {
        ...m,
        markPrice: s.markPriceOk ? human(s.markPrice, m.quoteDecimals) : undefined,
        markUpdatedAt: Number(s.indexUpdatedAt) * 1000,
        fundingRate: (human(s.fundingRate, 18)! * 3600) / s.fundingWindowSec,
        openInterest: human(s.openInterest, m.baseDecimals),
        error: s.markPriceOk
          ? undefined
          : 'On-chain mark feed is stale; order previews are blocked.',
      };
    } else
      m = { ...m, error: 'Live mark read failed; indexed mark is an older settlement snapshot.' };
    const matrix: MarketDetail['timeframes'] = {};
    const tfs = [...new Set<Timeframe>([tf, '15m', '1h', '4h'])];
    await Promise.all(
      tfs.map(async (t) => {
        try {
          const h = t === tf ? history.value : await candles(m, t);
          const a = analyze(h.candles, h.quality.stale);
          matrix[t] = {
            trend: a.trend,
            rsi: a.values.rsi,
            macd: a.values.macdHistogram,
            structure: a.structure,
            count: h.candles.length,
          };
        } catch {
          /* Missing matrix cell is an explicit unavailable state. */
        }
      }),
    );
    const trends = Object.values(matrix)
      .map((v) => v!.trend)
      .filter((v) => v !== 'Unavailable');
    const bull = trends.filter((v) => v === 'Bullish').length,
      bear = trends.filter((v) => v === 'Bearish').length;
    const agreement = trends.length >= 2 ? Math.max(bull, bear) / trends.length : null;
    const a = analyze(history.value.candles, history.value.quality.stale, agreement);
    return {
      market: m,
      candles: history.value.candles,
      quality: history.value.quality,
      analysis: a,
      book: ob.status === 'fulfilled' ? ob.value : null,
      bookError: ob.status === 'rejected' ? 'On-chain depth is unavailable.' : undefined,
      timeframes: matrix,
    };
  });
}
const scanCache = new AsyncCache<ScanRow[]>(45000);
type ScanRow = {
  market: Market;
  analysis: ReturnType<typeof analyze>;
  quality: ReturnType<typeof normalizeCandles>['quality'];
  error?: string;
};
export async function scan(tf: Timeframe) {
  return scanCache.get(tf, async () => {
    const ms = await markets();
    const output: ScanRow[] = [];
    for (let i = 0; i < ms.length; i += 4) {
      await Promise.all(
        ms.slice(i, i + 4).map(async (m) => {
          try {
            const [h, stats] = await Promise.all([
              candles(m, tf),
              sdk.client
                .getMarketStats24h({ pool: m.poolAddress, marketId: m.id })
                .catch(() => null),
            ]);
            const a = analyze(h.candles, h.quality.stale);
            output.push({
              market: {
                ...m,
                change24h: stats?.openPrice24h
                  ? (Number(stats.priceChange24h) / Number(stats.openPrice24h)) * 100
                  : undefined,
                volume24h: stats?.openPrice24h
                  ? human(stats.volume24h, m.quoteDecimals)
                  : undefined,
              },
              analysis: a,
              quality: h.quality,
            });
          } catch (e) {
            output.push({
              market: m,
              analysis: analyze([], true),
              quality: {
                source: 'dreamDEX Hideki indexer',
                fetchedAt: Date.now(),
                count: 0,
                gaps: 0,
                discarded: 0,
                stale: true,
                notes: [],
              },
              error: message(e),
            });
          }
        }),
      );
    }
    return output.sort((a, b) => b.analysis.score - a.analysis.score);
  });
}
export async function funding(id: string) {
  const m = await marketById(id);
  const [history, state] = await Promise.all([
    sdk.client.listFundingRateHistory(m.poolAddress, { limit: 24 }),
    sdk.client.getPerpState(m.poolAddress),
  ]);
  return {
    source: 'Hideki PerpPool funding events',
    fetchedAt: Date.now(),
    nextDueAt: Number(state.nextFundingAt) * 1000,
    settlementInterval: state.fundingIntervalSec,
    calculationWindow: state.fundingWindowSec,
    openInterest: human(state.openInterest, m.baseDecimals),
    history: history.map((r) => ({
      time: Number(r.timestamp) * 1000,
      rate1h: (human(r.fundingRate, 18)! * 3600) / r.fundingWindowSec,
      window: r.fundingWindowSec,
      intervalsSettled: r.intervalsSettled,
      intervalsAccrued: r.intervalsAccrued,
      txHash: r.txHash,
    })),
  };
}
export function message(e: unknown) {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 500 ? s.slice(0, 500) : s;
}
export async function account(address: Address) {
  const ms = await markets();
  if (!ms.length) throw new Error('No perp markets discovered');
  const m = ms[0];
  const [margin, positions, orders, fills, changes, gas, voucher] = await Promise.allSettled([
    sdk.client.getMarginAccount(m.marginBank, address),
    sdk.client.listPerpPositions(address),
    sdk.client.getOrders(address, { markets: ms.map((v) => v.id), limit: 100 }),
    sdk.client.getUserFills(address, { markets: ms.map((v) => v.id), limit: 100 }),
    sdk.client.listPerpPositionChanges({ account: address, limit: 100 }),
    rpc.getBalance({ address }),
    sdk.client.getPerpVoucher(m.marginBank, address),
  ]);
  const value = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
  const [analytics, payments] = await Promise.allSettled([
    sdk.client.listPerpPositionAnalytics({ marginBank: m.marginBank, account: address }),
    sdk.client.getFundingPayments(address, { limit: 100 }),
  ]);
  // Historical rows remain bounded for display. Risk uses every resting order at the bank snapshot block.
  const currentMargin = value(margin);
  const openOrders = await Promise.resolve()
    .then(() => {
      if (!currentMargin) throw new Error('Margin snapshot unavailable');
      return sdk.client.getOpenOrdersOnchain(
        ms.map((v) => v.poolAddress),
        address,
        { blockNumber: currentMargin.asOfBlock },
      );
    })
    .then(
      (result) => ({ result, error: undefined }),
      () => ({
        result: null,
        error: 'Authoritative open-order read unavailable; exposure is incomplete',
      }),
    );
  const exposure = verifyExposure(address, ms, currentMargin, value(analytics), openOrders.result);
  return {
    address,
    fetchedAt: Date.now(),
    quoteDecimals: m.quoteDecimals,
    margin: value(margin),
    positions: value(positions)
      ?.filter((p) => BigInt(p.size) !== 0n)
      .map((p) => ({
        ...p,
        isLong: BigInt(p.size) > 0n,
        entryPriceX18: p.avgEntryPrice,
        realizedPnl: p.lastUpdateRealizedPnl,
      })),
    analytics: value(analytics),
    openOrders: openOrders.result?.orders ?? null,
    exposure,
    fundingPayments: value(payments),
    orders: value(orders),
    fills: value(fills),
    changes: value(changes),
    gas: value(gas)?.toString(),
    voucher: value(voucher),
    errors: [
      ...(openOrders.error ? [openOrders.error] : []),
      ...exposure.reasons,
      ...[margin, positions, orders, fills, changes, gas, voucher, analytics, payments].flatMap(
        (r, i) =>
          r.status === 'rejected'
            ? [
                [
                  'Margin',
                  'Positions',
                  'Orders',
                  'Fills',
                  'Position changes',
                  'STT balance',
                  'Voucher',
                  'Position analytics',
                  'Funding payments',
                ][i] +
                  ': ' +
                  message(r.reason),
              ]
            : [],
      ),
    ],
  };
}
export async function prepare(plan: Plan, account: Address, approvedData?: Hex) {
  if (plan.errors.length) throw new Error(plan.errors.join('; '));
  const m = await marketById(plan.input.marketId),
    quantity = BigInt(plan.rawQuantity);
  let price = BigInt(plan.rawPrice);
  if (plan.input.type === 'market') {
    const factor = new Decimal(plan.input.slippageBps).div(10000);
    const bound = new Decimal(plan.rawPrice)
      .mul(plan.input.side === 'long' ? factor.plus(1) : new Decimal(1).minus(factor))
      .div(m.tickSize);
    price = BigInt(
      (plan.input.side === 'long' ? bound.floor() : bound.ceil()).mul(m.tickSize).toFixed(0),
    );
    const b = await book(m),
      best = plan.input.side === 'long' ? b.asks[0] : b.bids[0];
    if (!best) throw new Error('No visible opposite-side liquidity for an IOC order');
    const humanPrice = human(price, m.quoteDecimals)!;
    if (plan.input.side === 'long' ? humanPrice < best.price : humanPrice > best.price)
      throw new Error(
        'Reference price plus slippage does not cross the visible book. Review your entry and slippage.',
      );
  }
  if (
    quantity <= 0n ||
    quantity < BigInt(m.minQuantity) ||
    quantity % BigInt(m.lotSize) !== 0n ||
    price <= 0n ||
    price % BigInt(m.tickSize) !== 0n
  )
    throw new Error('Invalid raw market increments');
  if ((await rpc.getChainId()) !== NETWORK.id)
    throw new Error('RPC chain mismatch; signing disabled');
  const system = await sdk.client.getPerpSystemConfig(m.marginBank);
  if (system.collateralToken.toLowerCase() !== m.quoteToken.toLowerCase() || !system.fullyWired)
    throw new Error('Perp collateral or system configuration mismatch');
  const max = await sdk.client.getMaxPerpOrderSize({
    pool: m.poolAddress,
    marginBank: m.marginBank,
    account,
    isBid: plan.input.side === 'long',
    price,
    autoPull: false,
  });
  if (!max.priceable) throw new Error('Mark feed is stale; no valid order quote');
  if (!max.placeable || quantity > max.maxQuantity)
    throw new Error(`Order blocked by official account sizing: ${max.limitedBy}`);
  let expire = BigInt(Date.now() + 86400000) * 1000000n;
  if (approvedData) {
    const previous = decodeFunctionData({ abi: perpPoolWriteAbi, data: approvedData });
    if (previous.functionName !== 'placeOrder')
      throw new Error('Approved calldata is not a placeOrder request');
    expire = previous.args[4];
    const nowNs = BigInt(Date.now()) * 1000000n;
    if (expire <= nowNs + 30000000000n || expire > nowNs + 86400000000000n)
      throw new Error('Approved order expiry is invalid or too close. Review a new preview.');
  }
  const data = encodeFunctionData({
    abi: perpPoolWriteAbi,
    functionName: 'placeOrder',
    args: [
      plan.input.side === 'long',
      0n,
      price,
      quantity,
      expire,
      plan.input.type === 'market' ? 2 : 0,
      0,
      zeroAddress,
      0n,
    ],
  });
  if (approvedData && data.toLowerCase() !== approvedData.toLowerCase())
    throw new Error('Order parameters changed. Review a new preview.');
  await rpc.call({ account, to: m.poolAddress, data });
  const gasEstimate = await rpc.estimateGas({ account, to: m.poolAddress, data });
  const gas = (gasEstimate * 125n) / 100n,
    gasPrice = await rpc.getGasPrice();
  const balance = await rpc.getBalance({ address: account });
  if (balance < gas * gasPrice) throw new Error('Insufficient STT for estimated network gas');
  return {
    chainId: NETWORK.id,
    account,
    to: m.poolAddress,
    data,
    value: '0',
    gas: gas.toString(),
    gasPrice: gasPrice.toString(),
    estimatedGasSTT: fromRaw(gas * gasPrice, 18),
    expiresAt: Date.now() + 30000,
    market: m.symbol,
    maxQuantity: max.maxQuantity.toString(),
    limitedBy: max.limitedBy,
    rawPrice: price.toString(),
    rawQuantity: quantity.toString(),
    orderType: plan.input.type,
  };
}
export async function prepareCancel(id: string, orderId: string, account: Address) {
  const m = await marketById(id);
  if ((await rpc.getChainId()) !== NETWORK.id)
    throw new Error('RPC chain mismatch; signing disabled');
  const order = await sdk.client.getOrder(m.poolAddress, orderId);
  if (
    !order ||
    order.owner.toLowerCase() !== account.toLowerCase() ||
    order.status !== 'Open' ||
    BigInt(order.quantityRemaining) <= 0n
  )
    throw new Error('Order is unavailable or belongs to a different account');
  const data = encodeFunctionData({
    abi: perpPoolWriteAbi,
    functionName: 'cancelOrder',
    args: [BigInt(orderId)],
  });
  await rpc.call({ account, to: m.poolAddress, data });
  const gas = ((await rpc.estimateGas({ account, to: m.poolAddress, data })) * 125n) / 100n;
  const gasPrice = await rpc.getGasPrice();
  if ((await rpc.getBalance({ address: account })) < gas * gasPrice)
    throw new Error('Insufficient STT for estimated cancellation gas');
  return {
    chainId: NETWORK.id,
    account,
    to: m.poolAddress,
    data,
    value: '0',
    gas: gas.toString(),
    gasPrice: gasPrice.toString(),
    estimatedGasSTT: fromRaw(gas * gasPrice, 18),
    expiresAt: Date.now() + 30000,
    market: m.symbol,
    orderId,
  };
}
export async function receipt(hash: Hex, id: string, owner: Address) {
  const m = await marketById(id);
  if ((await rpc.getChainId()) !== NETWORK.id) throw new Error('Receipt RPC chain mismatch');
  const [tx, r] = await Promise.all([
    rpc.getTransaction({ hash }),
    rpc.getTransactionReceipt({ hash }),
  ]);
  if (
    tx.to?.toLowerCase() !== m.poolAddress.toLowerCase() ||
    tx.from.toLowerCase() !== owner.toLowerCase()
  )
    throw new Error('Receipt does not match this account and perp pool');
  const events = r.logs
    .filter((l) => l.address.toLowerCase() === m.poolAddress.toLowerCase())
    .flatMap((l) => {
      try {
        return [decodeEventLog({ abi: orderBookEventsAbi, data: l.data, topics: l.topics })];
      } catch {
        return [];
      }
    });
  const decoded = decodeFunctionData({ abi: perpPoolWriteAbi, data: tx.input });
  if (!['placeOrder', 'cancelOrder'].includes(decoded.functionName))
    throw new Error('Unsupported transaction call; no submission can be reconciled');
  const block = await rpc.getBlock({ blockNumber: r.blockNumber });
  const placed = events.find((v) => v.eventName === 'OrderPlaced');
  const raw =
    decoded.functionName === 'cancelOrder'
      ? decoded.args[0]
      : (placed?.args as { placedOrder?: { orderId?: bigint } } | undefined)?.placedOrder?.orderId;
  const order = raw ? await sdk.client.getOrder(m.poolAddress, raw).catch(() => null) : null;
  const cancelled =
    decoded.functionName === 'cancelOrder' &&
    events.some((e) => e.eventName === 'OrderCancelled' && e.args.orderId === raw);
  const rested =
    raw !== undefined &&
    events.some((e) => e.eventName === 'OrderRested' && e.args.orderId === raw);
  const fills =
    raw === undefined
      ? []
      : events.filter(
          (e) =>
            e.eventName === 'OrderFilled' &&
            (e.args.takerOrderId === raw || e.args.makerOrderId === raw),
        );
  const lastFill = fills.at(-1);
  const remaining =
    lastFill?.eventName === 'OrderFilled'
      ? lastFill.args.takerOrderId === raw
        ? lastFill.args.takerRemainingQuantity
        : lastFill.args.makerRemainingQuantity
      : undefined;
  const state = orderOutcome({
    reverted: r.status === 'reverted',
    cancellation: decoded.functionName === 'cancelOrder',
    cancelled,
    rested,
    remaining,
    fillCount: fills.length,
    order,
  });
  return {
    hash,
    network: NETWORK.id,
    market: m.symbol,
    pool: m.poolAddress,
    account: owner,
    input: tx.input,
    transactionStatus: r.status === 'reverted' ? 'reverted' : 'confirmed',
    transactionTimestamp: Number(block.timestamp) * 1000,
    indexerStatus: order ? 'available' : raw === undefined ? 'not-observed' : 'unavailable',
    receipt: r,
    events,
    orderId: raw?.toString(),
    order,
    state,
    fillEvidence: fills,
    orderParameters: decoded,
    checkedAt: Date.now(),
  };
}
