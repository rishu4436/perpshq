import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Analysis } from '../../../packages/shared-types';
import { ema, sma, bollinger } from '../../../packages/indicator-engine';
export function Chart({
  candles,
  analysis,
  overlays,
  height = 340,
}: {
  candles: Candle[];
  analysis: Analysis;
  overlays: string[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#151914' },
        textColor: '#b0b8aa',
        fontFamily: 'DM Sans Variable, sans-serif',
        fontSize: 12,
      },
      grid: { vertLines: { color: '#252d23' }, horzLines: { color: '#252d23' } },
      rightPriceScale: { borderColor: '#2b3330' },
      timeScale: { borderColor: '#2b3330', timeVisible: true },
      crosshair: {
        vertLine: { color: '#7d9d91', labelBackgroundColor: '#31433b' },
        horzLine: { color: '#7d9d91', labelBackgroundColor: '#31433b' },
      },
      handleScroll: true,
      handleScale: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#c4e99a',
      downColor: '#ed9a8a',
      borderVisible: false,
      wickUpColor: '#c4e99a',
      wickDownColor: '#ed9a8a',
      priceFormat: {
        type: 'price',
        precision: candles.at(-1)!.close < 1 ? 6 : 2,
        minMove: candles.at(-1)!.close < 1 ? 0.000001 : 0.01,
      },
    });
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    series.priceScale().applyOptions({
      scaleMargins: { top: 0.1, bottom: overlays.includes('Volume') ? 0.22 : 0.08 },
    });
    const close = candles.map((c) => c.close);
    for (const [kind, p, color] of [
      ['EMA', 9, '#b2d6bd'],
      ['EMA', 20, '#cbb889'],
      ['EMA', 50, '#91a7e7'],
      ['EMA', 100, '#cc9ea7'],
      ['EMA', 200, '#bd93ce'],
      ['SMA', 20, '#81b8c4'],
      ['SMA', 50, '#aaab78'],
      ['SMA', 200, '#c29fd5'],
    ] as const) {
      if (overlays.includes(kind + ' ' + p)) {
        const e = kind === 'EMA' ? ema(close, p) : sma(close, p);
        const l = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        l.setData(
          e.flatMap((v, i) =>
            v === null ? [] : [{ time: candles[i].time as UTCTimestamp, value: v }],
          ),
        );
      }
    }
    if (overlays.includes('Bollinger')) {
      const b = bollinger(close);
      for (const a of [b.upper, b.lower]) {
        const l = chart.addSeries(LineSeries, {
          color: '#586b66',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        l.setData(
          a.flatMap((v, i) =>
            v === null ? [] : [{ time: candles[i].time as UTCTimestamp, value: v }],
          ),
        );
      }
    }
    if (overlays.includes('Volume') && candles.every((c) => c.volume !== undefined)) {
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      volume.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume!,
          color: c.close >= c.open ? '#28493d' : '#493233',
        })),
      );
    }
    if (overlays.includes('S/R zones'))
      for (const z of analysis.zones.slice(0, 4)) {
        series.createPriceLine({
          price: z.low,
          color: z.kind === 'support' ? '#497e65' : '#97625e',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: z.kind === 'support' ? 'S zone' : 'R zone',
        });
        series.createPriceLine({
          price: z.high,
          color: z.kind === 'support' ? '#345f4c' : '#6d4846',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
      }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, analysis, overlays, height]);
  return (
    <div
      className="chart"
      ref={ref}
      style={{ height }}
      role="img"
      aria-label="Interactive dreamDEX perpetual candlestick chart with enabled overlays"
    />
  );
}
