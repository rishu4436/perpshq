# Indicator and score methodology

All inputs are actual completed Hideki perp fill candles in production. Synthetic analytic vectors exist only in tests. Calculations are deterministic, contain no LLM, and never imply validated predictive accuracy.

## Quality and warm-up

Reject invalid OHLC, negative volume, invalid or unaligned timestamps, unfinished buckets and mixed intervals. Sort ascending, deduplicate by timestamp, report gaps and use only the most recent contiguous suffix for indicators. Do not treat a missing interval as a zero-volume candle. Aggregation requires every compatible constituent bucket at exact UTC boundaries and refuses partial/mixed-market/mixed-source groups.

- SMA: arithmetic average over `p` observations; first value at `p−1`.
- EMA: full-window SMA seed, then alpha `2/(p+1)`; first value at `p−1`. EMA 200 requires 200 observations. Startup seeding still has finite-history bias; no assertion of equilibrium.
- RSI 14: Wilder-smoothed gains and losses from 14 price changes, requiring 15 closes. Flat price yields 50; zero losses with gains yields 100; zero gains with losses yields 0.
- MACD: EMA 12 minus EMA 26; signal is a nine-observation EMA of valid MACD values. First histogram requires 34 closes.
- Bollinger: SMA 20 ± two population standard deviations. Width = `(upper−lower)/middle × 100`. Position = `(close−lower)/(upper−lower)`; flat bands use 0.5 to avoid division by zero.
- ATR 14: Wilder average of true ranges, including gaps to previous close; first value after 14 ranges / 15 candles.
- ADX 14: Wilder smoothed true range and directional movement, then Wilder DX; first value with 28 candles. Values describe directional strength, not direction.
- Stochastic RSI: 14-period RSI, 14 valid RSI window, three-observation K and D smoothing. Flat RSI window uses 50.
- Relative volume: completed base volume divided by its SMA 20; unavailable when any required volume is missing or the divisor is zero.
- VWAP: UTC-day cumulative typical-price × base-volume / volume. Valid only from supplied price/volume observations and may represent a partial day. No full-day claim is made when history begins mid-session.

The UI exposes all required EMA 9/20/50/100/200 and SMA 20/50/200 values, plus momentum and volatility measures. Overlay toggles include every required EMA/SMA period, Bollinger Bands, volume and zones. Custom periods and RSI thresholds are not yet exposed.

## Support, resistance and structure

Default pivot window: three bars on each side. A pivot requires a strict high/low relative to every neighbor; plateaus are not pivots. A pivot becomes knowable only at its right-side confirmation timestamp. The most recent 250 observations contribute pivots. Levels within 0.3% are clustered, with padding of half that tolerance on each side. Zone touch count counts confirmed pivots, not every candle that overlaps.

Strength = `min(100, 18 × pivotTouches + recencyBonus)`; recency bonus declines from 30 across the available history span. Strength is evidence density, not reversal probability. Two consecutive completed closes beyond the far boundary after latest confirmation invalidate the zone. Zones overlapping current price are withheld. Nearest support/resistance are selected by distance to zone midpoint. Market structure compares the latest two confirmed highs and lows; otherwise reports consolidation/transition or insufficient pivots. Re-running on historical prefixes never imports future pivot confirmation.

## Opportunity score

Weights total 100: EMA trend 25, MACD agreement 20, relative volume 10, structure 15, ADX strength 10, level evidence 10, timeframe agreement 10. Configuration is exported as `defaultWeights`; Settings accepts nonnegative alternative weights totaling 100 and applies them to scanner/cockpit rankings.

Normalized inputs: directional EMA alignment 1 (mixed 0.3); MACD histogram agreement with EMA direction 1/0 (mixed trend 0.3); relative volume / 2 capped at 1; directional confirmed structure 1 (transition 0.3); ADX / 40 capped at 1; nearest zone touches / 4 capped at 1; largest bullish/bearish timeframe count / available non-unavailable timeframe count, requiring at least two timeframes.

Score = rounded weighted sum divided by the sum of nonnegative configured weights, ×100. Missing factors contribute **zero** with the denominator unchanged. Coverage is the fraction of configured weight having evidence. Stale history zeros scores, coverage and interpretations. Scanner rows have no multi-timeframe contribution; cockpit detail can fetch the comparison matrix. These contexts therefore can produce different scores, visibly explained in the breakdown.

Presets are fixed, inspectable rules in `matchesPreset`. Volatility expansion requires ATR or Bollinger width to increase by more than 10% against five completed candles earlier. Trend pullbacks require price within one ATR of EMA 20 plus a five-bar retracement opposite the directional EMA trend. Possible breakouts combine confirmed-zone proximity, extreme band position, relative volume above one and increasing ATR. The exploratory historical evaluator measures actual forward observations with explicit costs and a chronological split; no statistical edge is claimed.

## Risk calculations

Risk per unit = entry-to-stop distance + `(entry+stop)×slippageFraction`; risk quantity = riskBudget / riskPerUnit, rounded down to lot. Target reward subtracts adverse entry/exit slippage. Invalid stop/target direction, insufficient margin, over-budget overrides, excess market leverage, bad ticks and sizes are rejected. Funding and network costs are explicitly outside those estimates. Stops remain plan notes until native protective orders are implemented. Cross-margin liquidation is unavailable rather than approximated with a single-position formula.

## Independent checks

Tests include hand-calculable rolling averages, a linear-ramp MACD identity, population standard deviation for [1…5], a true-range gap example, monotonic-trend ADX, exact bigint round-trips at 24 decimals and published Wilder RSI worksheet values (70.464135 at its first sample). Prefix-invariance tests guard against lookahead. Tests are in `tests/unit/engines.test.ts`; expected values are not generated by the implementation under test.

## Unavailable scenarios

Directional zones/structure scenarios require at least 50 fresh completed bars. Stale or shorter history returns explicit unavailable bullish/bearish messages and no actionable zones; stale calculations do not leak price levels into scenario text. Structure contributes no evidence while unavailable. The UI also withholds cached interpretations after 90 seconds without a successful read. Existing indicator-specific warm-up rules still apply.
