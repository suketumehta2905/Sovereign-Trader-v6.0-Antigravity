/**
 * Order Block Detector — Phase 4 Institutional Upgrade
 *
 * Enhancements over original:
 *   1. ATR + Volume validation (from LuxAlgo Strength Classifier)
 *   2. Strength scoring 0–100 (displacement × 0.6 + volume × 0.4)
 *   3. Breaker Block conversion (failed OBs become inverse S/R zones)
 *
 * Drop-in replacement for ict-agent/src/engine/orderBlockDetector.js
 */

import {
  OB_DISP_MULT, OB_VOL_MULT,
  OB_STRENGTH_DISP_W, OB_STRENGTH_VOL_W,
  OB_MAX_DISP_ATR, OB_MAX_VOL_RATIO,
  OB_ENABLE_BREAKERS,
} from './engineConfig';

const OB_LOOKBACK = 200;

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

function calcVolSMA(candles, period = 20) {
  if (candles.length < period) {
    const sum = candles.reduce((s, c) => s + (c.volume || 0), 0);
    return sum / candles.length || 1;
  }
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + (c.volume || 0), 0) / period || 1;
}

function avgBody(candles) {
  const bodies = candles.map((c) => Math.abs(c.close - c.open));
  return bodies.reduce((a, b) => a + b, 0) / bodies.length;
}

/**
 * Calculate OB strength score (0–100)
 * Based on LuxAlgo Institutional Order Flow Strength Classifier
 */
function calcStrength(displacement, atr, volume, volSMA) {
  const dispRatio = atr > 0 ? displacement / atr : 0;
  const volRatio = volSMA > 0 ? volume / volSMA : 0;

  const dispFactor = Math.min(dispRatio / OB_MAX_DISP_ATR, 1.0);
  const volFactor = Math.min(volRatio / OB_MAX_VOL_RATIO, 1.0);

  return Math.round((dispFactor * OB_STRENGTH_DISP_W + volFactor * OB_STRENGTH_VOL_W) * 100);
}

/**
 * Mitigation check with Breaker Block conversion
 */
function checkMitigation(ob, slice, obIndex) {
  let enteredZone = false;
  let brokeThrough = false;

  for (let j = obIndex + 2; j < slice.length; j++) {
    const c = slice[j];
    if (ob.type === 'bullish') {
      if (c.low <= ob.top) {
        enteredZone = true;
        if (c.low < ob.mid) brokeThrough = true;
      }
    } else {
      if (c.high >= ob.bottom) {
        enteredZone = true;
        if (c.high > ob.mid) brokeThrough = true;
      }
    }
  }

  if (!enteredZone) return { mitigated: false, mitigation: 'fresh' };
  if (!brokeThrough) return { mitigated: true, mitigation: 'tested' };
  return { mitigated: true, mitigation: 'broken' };
}

export function detectOrderBlocks(candles) {
  if (!candles || candles.length < 10) return [];
  const slice = candles.slice(-OB_LOOKBACK);
  const avg = avgBody(slice);
  const atr = calcATR(slice);
  const volSMA = calcVolSMA(slice);
  const obs = [];

  for (let i = 1; i < slice.length - 1; i++) {
    const cur = slice[i];
    const next = slice[i + 1];

    const nextBody = Math.abs(next.close - next.open);
    const curTop = Math.max(cur.open, cur.close);
    const curBot = Math.min(cur.open, cur.close);
    const curMid = (curTop + curBot) / 2;
    const curVol = cur.volume || 0;

    // ── Bullish OB (Demand Zone) ──────────────────────────────────────────
    if (
      cur.close < cur.open &&                           // cur IS bearish
      next.close > next.open &&                         // next is bullish displacement
      next.close > curTop                               // closes above OB
    ) {
      const displacement = next.close - curBot;

      // Institutional filter: ATR + Volume validation
      const passesATR = displacement >= atr * OB_DISP_MULT;
      const passesVol = curVol >= volSMA * OB_VOL_MULT;

      if (curTop - curBot >= avg * 0.1) {
        const strength = (passesATR && passesVol)
          ? calcStrength(displacement, atr, curVol, volSMA)
          : Math.round((nextBody / avg) * 15); // Fallback: basic body ratio score

        const mitResult = checkMitigation(
          { type: 'bullish', top: curTop, bottom: curBot, mid: curMid }, slice, i
        );

        const ob = {
          type:        'bullish',
          time:         cur.time,
          top:          curTop,
          bottom:       curBot,
          mid:          curMid,
          valid:        true,
          strength,                           // 0–100 institutional score
          institutional: passesATR && passesVol, // true = passed Pine Script filters
          sliceIndex:   i,
          ...mitResult,
        };

        // Breaker Block: if broken, flip to bearish resistance zone
        if (OB_ENABLE_BREAKERS && mitResult.mitigation === 'broken') {
          ob.type = 'bearish';
          ob.isBreaker = true;
          ob.strength = Math.round(ob.strength * 0.7); // Breakers are slightly weaker
        }

        obs.push(ob);
      }
    }

    // ── Bearish OB (Supply Zone) ──────────────────────────────────────────
    if (
      cur.close > cur.open &&                           // cur IS bullish
      next.close < next.open &&                         // next is bearish displacement
      next.close < curBot                               // closes below OB
    ) {
      const displacement = curTop - next.close;

      const passesATR = displacement >= atr * OB_DISP_MULT;
      const passesVol = curVol >= volSMA * OB_VOL_MULT;

      if (curTop - curBot >= avg * 0.1) {
        const strength = (passesATR && passesVol)
          ? calcStrength(displacement, atr, curVol, volSMA)
          : Math.round((nextBody / avg) * 15);

        const mitResult = checkMitigation(
          { type: 'bearish', top: curTop, bottom: curBot, mid: curMid }, slice, i
        );

        const ob = {
          type:        'bearish',
          time:         cur.time,
          top:          curTop,
          bottom:       curBot,
          mid:          curMid,
          valid:        true,
          strength,
          institutional: passesATR && passesVol,
          sliceIndex:   i,
          ...mitResult,
        };

        if (OB_ENABLE_BREAKERS && mitResult.mitigation === 'broken') {
          ob.type = 'bullish';
          ob.isBreaker = true;
          ob.strength = Math.round(ob.strength * 0.7);
        }

        obs.push(ob);
      }
    }
  }

  // Return last 8 of each type, sorted by time
  const bullOBs = obs.filter((o) => o.type === 'bullish').slice(-8);
  const bearOBs = obs.filter((o) => o.type === 'bearish').slice(-8);
  return [...bullOBs, ...bearOBs].sort((a, b) => a.time - b.time);
}

/**
 * Get nearest OB to current price
 */
export function getNearestOB(candles, currentPrice, bias) {
  const obs = detectOrderBlocks(candles);
  const relevant = obs.filter((ob) =>
    bias === 'LONG' ? ob.type === 'bullish' : ob.type === 'bearish'
  );

  let best = null;
  let bestDist = Infinity;

  for (const ob of relevant) {
    if (currentPrice >= ob.bottom && currentPrice <= ob.top) {
      return { ...ob, inside: true };
    }
    const dist = Math.min(
      Math.abs(currentPrice - ob.top),
      Math.abs(currentPrice - ob.bottom)
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = ob;
    }
  }

  return best ? { ...best, inside: false, distance: bestDist } : null;
}
