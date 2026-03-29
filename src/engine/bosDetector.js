/**
 * BOS (Break of Structure) and CHOCH (Change of Character) detector
 * Scans candle history and returns events with time positions for chart markers.
 *
 * BOS   = break in the SAME direction as the prevailing trend
 * CHOCH = break AGAINST the prevailing trend (change of character)
 */

const LOOKBACK = 20;

export function detectBOSCHOCH(candles) {
  if (!candles || candles.length < LOOKBACK + 3) return [];

  const events = [];
  let trend = 'neutral'; // 'bull' | 'bear' | 'neutral'

  for (let i = LOOKBACK; i < candles.length - 1; i++) {
    const slice     = candles.slice(i - LOOKBACK, i);
    const swingHigh = Math.max(...slice.map((c) => c.high));
    const swingLow  = Math.min(...slice.map((c) => c.low));
    const cur       = candles[i];
    const prev      = candles[i - 1];

    // Bullish break: close above swing high
    if (cur.close > swingHigh && prev.close <= swingHigh) {
      const isCHOCH = trend === 'bear';
      events.push({
        type:     isCHOCH ? 'choch_bull' : 'bos_bull',
        time:     cur.time,
        price:    swingHigh,
        label:    isCHOCH ? 'ChoCH' : 'BOS',
        color:    isCHOCH ? '#f97316' : '#22c55e',
        position: 'belowBar',
        shape:    'arrowUp',
      });
      trend = 'bull';
    }

    // Bearish break: close below swing low
    if (cur.close < swingLow && prev.close >= swingLow) {
      const isCHOCH = trend === 'bull';
      events.push({
        type:     isCHOCH ? 'choch_bear' : 'bos_bear',
        time:     cur.time,
        price:    swingLow,
        label:    isCHOCH ? 'ChoCH' : 'BOS',
        color:    isCHOCH ? '#f97316' : '#ef4444',
        position: 'aboveBar',
        shape:    'arrowDown',
      });
      trend = 'bear';
    }
  }

  // Return most recent 12 events to avoid cluttering the chart
  return events.slice(-12);
}
