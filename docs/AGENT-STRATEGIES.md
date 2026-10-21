# Agent strategies and simulation assumptions

Strategies reuse the existing indicator/market-structure engines over actual normalized **completed** candles. Indicators are recomputed, not trusted from cached scores. Warm-up is max(50, configured slow EMA). Candle identity, OHLC integrity, ordering, alignment and age are checked independently. A fresh fetch cannot revive old history. Every enabled condition and then central risk must pass; a candidate is never a fill or profitability claim.

| Strategy                    | Rules                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-timeframe trend       | Configurable fast/slow EMA alignment, MACD momentum, side-specific RSI range, ADX minimum, coverage and independently sourced timeframe agreement.                                                                                            |
| Support/resistance breakout | Prior-prefix confirmed pivot zone, previous close on original side, current completed close across zone, ATR bounds, optional volume ratio and fresh opposite-side book. Action/failure cooldown limits rapid retries.                        |
| Mean reversion              | RSI extreme/recovery, current/prior Bollinger position, distance from EMA, ranging ADX ceiling, ATR bounds and optional price/RSI recovery confirmation. RSI alone is insufficient.                                                           |
| Risk Guardian               | Existing positions: watched stop/target or trend exit, health deterioration, unrealized loss and exposure. Proposes bounded 25% reduction or full opposite-side close. No entry seeking. Excess orders produce a cancellation recommendation. |

Side policy restricts long/short candidates. Ordinary strategies also monitor held-position exits. Guardian pauses on stale/invalid data or actual missing/insufficient operator gas; it cannot protect exposure while its process, data or chain is unavailable.

## Paper trading

Paper cash/leverage are assumptions, never wallet balances. Size is lot-aligned, bounded by notional and estimated stop/slippage/fee budget. Stops/targets are watched references. Adverse slippage applies to visible book levels within the proposal bound. Fresh uncrossed two-sided depth is required; missing liquidity never gets invented fills. Visible quantity caps partial fills, and each snapshot is consumed once per ledger.

Resting limits fill only when a later book crosses them, with expiry. There is no maker queue/hidden liquidity model. Fees/hourly funding are configured assumptions, not actual payments. Net closed outcomes allocate entry/exit fees and funding across partial reductions. Equity/drawdown use stored ledger and fresh marks. Paper action counters are simulated attempts, not blockchain transactions.

## Historical evaluation

Actual market/timeframe input is normalized and evaluated by chronological prefix. Pivot confirmation uses only then-available candles. Higher frames aggregate compatible completed buckets. Exploration uses the earlier 70% with warm-up; validation starts a fresh ledger in the final partition. No fills cross the partition boundary. This temporal split is not statistical proof of an optimized edge.

Candidates fill only at the next **observed** bar open, with adverse slippage and the execution bound. Prior-known volume participation caps quantity; lot/minimum constraints apply. Missing volume means no modeled fill. No historical book is invented, so liquidity-required breakout signals remain unavailable historically. Limits use the same next-open check, never favorable intrabar assumptions. Watched exits evaluate closes, not imaginary stop-price fills. Constant funding is assumed; gas, liquidation, maker priority, hidden depth and execution latency are not reconstructed.

Reports include period/coverage, evaluated bars, candidates/fills, closed net average, reconstructible wins/losses, observed adverse excursion, costs, equity change and drawdown. Short samples/no closed trades leave statistics unavailable. No confidence score, positive expected return or predictive accuracy is asserted.

## Deliberate limits

Internal indicator definitions remain fixed beyond exposed EMA periods/thresholds. Breakout uses existing pivot heuristics/general cooldown, not a trained false-breakout classifier. Guardian cannot arm native stops or assure liquidation prevention. Opposite-side IOC reductions can over-close if actual state changes; **broadcast remains disabled**. SDK interfaces expose no atomic reduce-only guarantee. Agents simulate independent ledgers, not a pooled portfolio. Bounded actual account history does not establish daily/session P&L, so assisted increases remain blocked.
