/**
 * Advanced Trendline Detector
 * 
 * Algorithm:
 * 1. Identify Fractal points (peaks/troughs) using a lookback window.
 * 2. Iterate through combinations of recent pivots to form potential lines.
 * 3. Evaluate each line by counting touches and "slices" (price violations).
 * 4. Filter for the highest quality trendlines that define the current structure.
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

  const n = candles.length;
  const atr = calcATR(candles);
  const tolerance = atr * (TREND_TOLERANCE_ATR || 0.15);
  
  const peaks = [];
  const troughs = [];

  // 1. Identify Fractals (Pivots)
  const lookback = SWING_LOOKBACK_MACRO || 5;
  for (let i = lookback; i < n - lookback; i++) {
    let isPeak = true, isTrough = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i-j].high >= candles[i].high || (i+j < n && candles[i+j].high >= candles[i].high)) isPeak = false;
      if (candles[i-j].low <= candles[i].low || (i+j < n && candles[i+j].low <= candles[i].low)) isTrough = false;
    }
    if (isPeak)   peaks.push({ x: i, y: candles[i].high, time: candles[i].time });
    if (isTrough) troughs.push({ x: i, y: candles[i].low, time: candles[i].time });
  }

  const results = [];

  // 2. Helper to evaluate a potential line
  const evaluateLine = (p1, p2, type) => {
    const dx = p2.x - p1.x;
    if (dx === 0) return null;
    const slope = (p2.y - p1.y) / dx;
    let touches = 2;
    let violations = 0;
    
    // Scan everything from p1 to the end of the chart
    for (let i = p1.x + 1; i < n; i++) {
      const lineY = p1.y + slope * (i - p1.x);
      const low = candles[i].low;
      const high = candles[i].high;
      const close = candles[i].close;

      if (type === 'resistance') {
        if (close > lineY + tolerance) violations++;
        if (Math.abs(high - lineY) <= tolerance) touches++;
      } else {
        if (close < lineY - tolerance) violations++;
        if (Math.abs(low - lineY) <= tolerance) touches++;
      }
    }
    
    // Significant if low violation rate and at least 3 touches (or highly valid 2 touches)
    const span = n - p1.x;
    if (violations > span * 0.15) return null; // Too many violations
    if (touches < 2) return null;

    return {
      id: `${type}-${p1.x}-${p2.x}`,
      type,
      p1,
      p2,
      slope,
      touches,
      violations,
      score: (touches * 10) - (violations * 5)
    };
  };

  // 3. Process Peaks (Resistance)
  const recentPeaks = peaks.slice(-10); // Check last 10 peaks
  for (let i = 0; i < recentPeaks.length; i++) {
    for (let j = i + 1; j < recentPeaks.length; j++) {
      const line = evaluateLine(recentPeaks[i], recentPeaks[j], 'resistance');
      if (line) results.push(line);
    }
  }

  // 4. Process Troughs (Support)
  const recentTroughs = troughs.slice(-10); // Check last 10 troughs
  for (let i = 0; i < recentTroughs.length; i++) {
    for (let j = i + 1; j < recentTroughs.length; j++) {
      const line = evaluateLine(recentTroughs[i], recentTroughs[j], 'support');
      if (line) results.push(line);
    }
  }

  // 5. De-duplicate and Filter (Sort by score and pick top few)
  return results
    .sort((a, b) => b.score - a.score)
    .filter((v, i, a) => a.findIndex(t => Math.abs(t.slope - v.slope) < 0.0001) === i)
    .slice(0, 3)
    .map(t => ({
      ...t,
      color: t.type === 'resistance' ? '#ef4444' : '#22c55e',
      label: t.type === 'resistance' ? 'Resistance Trendline' : 'Support Trendline'
    }));
}
