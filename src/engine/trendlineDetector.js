/**
 * Trendline Detector
 * 
 * Algorithm:
 * 1. Find Fractal points (Local Peak/Trough) using a wide window.
 * 2. Pair most recent fractals and calculate slope.
 * 3. Verify if subsequent price points "confirm" the slope within a tolerance.
 * 4. Return valid Trendline rays.
 */

import { TREND_MIN_POINTS, TREND_TOLERANCE_ATR, SWING_LOOKBACK_MACRO } from './engineConfig';

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

export function detectTrendlines(candles) {
  if (!candles || candles.length < 50) return [];

  const atr = calcATR(candles);
  const tolerance = atr * TREND_TOLERANCE_ATR;
  const n = candles.length;
  
  const peaks = [];
  const troughs = [];

  // 1. Identify Fractals (Wide Window)
  for (let i = SWING_LOOKBACK_MACRO; i < n - 2; i++) {
    const c = candles[i];
    let isPeak = true, isTrough = true;
    for (let j = 1; j <= SWING_LOOKBACK_MACRO; j++) {
      if (candles[i-j].high >= c.high || (i+j < n && candles[i+j].high >= c.high)) isPeak = false;
      if (candles[i-j].low <= c.low || (i+j < n && candles[i+j].low <= c.low)) isTrough = false;
    }
    if (isPeak)   peaks.push({ x: i, y: c.high, time: c.time });
    if (isTrough) troughs.push({ x: i, y: c.low, time: c.time });
  }

  const results = [];

  // 2. Process Peaks (Resistance Lines)
  if (peaks.length >= 2) {
    // Try to connect the last 2 major peaks
    const p1 = peaks[peaks.length - 2];
    const p2 = peaks[peaks.length - 1];
    const slope = (p2.y - p1.y) / (p2.x - p1.x);
    
    // Extend to current price
    const currentPrice = candles[n-1].close;
    const projectY = p2.y + slope * (n - 1 - p2.x);
    
    // Only return if it's a "clean" line (not deeply sliced through by many candles)
    let slices = 0;
    for (let i = p1.x; i < n; i++) {
        const lineY = p1.y + slope * (i - p1.x);
        if (candles[i].close > lineY + tolerance) slices++;
    }

    if (slices < (n - p1.x) * 0.15) {
        results.push({
            id: `peak-tl-${p1.x}-${p2.x}`,
            type: 'resistance',
            p1, p2, slope,
            currentExtrapolated: projectY,
            color: '#ef4444', 
            label: 'Resistance Trendline'
        });
    }
  }

  // 3. Process Troughs (Support Lines)
  if (troughs.length >= 2) {
    const t1 = troughs[troughs.length - 2];
    const t2 = troughs[troughs.length - 1];
    const slope = (t2.y - t1.y) / (t2.x - t1.x);
    
    let slices = 0;
    for (let i = t1.x; i < n; i++) {
        const lineY = t1.y + slope * (i - t1.x);
        if (candles[i].close < lineY - tolerance) slices++;
    }

    if (slices < (n - t1.x) * 0.15) {
        results.push({
            id: `trough-tl-${t1.x}-${t2.x}`,
            type: 'support',
            p1: t1, p2: t2, slope,
            color: '#22c55e',
            label: 'Support Trendline'
        });
    }
  }

  return results;
}
