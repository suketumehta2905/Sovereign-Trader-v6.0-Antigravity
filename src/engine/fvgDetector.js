/**
 * Fair Value Gap (FVG) Detector — Phase 4 Institutional Upgrade
 *
 * Enhancements:
 *   1. ATR-based minimum gap size filter (from Statistical FVG Pine Script)
 *   2. Gap size in ATR units for cross-instrument comparison
 *
 * Drop-in replacement for ict-agent/src/engine/fvgDetector.js
 */

import { FVG_MIN_ATR } from './engineConfig';

const FVG_LOOKBACK = 60;

function calcATR(candles, period = 14) {
  if (candles.length < 2) return 1;
  const bars = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const c = bars[i], p = bars[i - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  return sum / (bars.length - 1) || 1;
}

export function detectFVGs(candles) {
  if (!candles || candles.length < 3) return [];
  const slice = candles.slice(-FVG_LOOKBACK);
  const atr = calcATR(slice);
  const minGap = atr * FVG_MIN_ATR;
  const fvgs = [];

  for (let i = 2; i < slice.length; i++) {
    const c0 = slice[i - 2];
    const c1 = slice[i - 1];
    const c2 = slice[i];

    // Bullish FVG: gap between c0.high and c2.low
    if (c0.high < c2.low) {
      const top = c2.low;
      const bottom = c0.high;
      const gapSize = top - bottom;
      const ce = (top + bottom) / 2;

      // ATR filter: only qualify significant gaps
      if (gapSize >= minGap) {
        fvgs.push({
          type: 'bullish',
          time: c1.time,
          top,
          bottom,
          ce,
          width: gapSize,
          gapATR: atr > 0 ? +(gapSize / atr).toFixed(2) : 0, // Gap size in ATR units
          filled: false,
        });
      }
    }

    // Bearish FVG: gap between c0.low and c2.high
    if (c0.low > c2.high) {
      const top = c0.low;
      const bottom = c2.high;
      const gapSize = top - bottom;
      const ce = (top + bottom) / 2;

      if (gapSize >= minGap) {
        fvgs.push({
          type: 'bearish',
          time: c1.time,
          top,
          bottom,
          ce,
          width: gapSize,
          gapATR: atr > 0 ? +(gapSize / atr).toFixed(2) : 0,
          filled: false,
        });
      }
    }
  }

  // Mark filled FVGs
  const lastClose = slice[slice.length - 1]?.close || 0;
  return fvgs
    .map((fvg) => ({
      ...fvg,
      filled:
        fvg.type === 'bullish'
          ? lastClose < fvg.bottom
          : lastClose > fvg.top,
    }))
    .filter((fvg) => !fvg.filled)
    .slice(-6);
}

/**
 * Check if price is in a FVG
 */
export function priceInFVG(candles, price, bias) {
  const fvgs = detectFVGs(candles).filter(
    (f) => (bias === 'LONG' ? f.type === 'bullish' : f.type === 'bearish')
  );
  return fvgs.some((f) => price >= f.bottom && price <= f.top);
}

/**
 * Get nearest FVG to current price
 */
export function getNearestFVG(candles, price, bias) {
  const fvgs = detectFVGs(candles);
  const relevant = bias
    ? fvgs.filter((f) => (bias === 'LONG' ? f.type === 'bullish' : f.type === 'bearish'))
    : fvgs;

  if (!relevant.length) return null;

  return relevant.reduce((best, fvg) => {
    const distA = Math.abs(price - fvg.ce);
    const distB = Math.abs(price - (best ? best.ce : Infinity));
    return distA < distB ? fvg : best;
  }, null);
}
