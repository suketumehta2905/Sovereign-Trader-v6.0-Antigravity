/**
 * Liquidity Detector — Phase 4 Institutional Upgrade
 *
 * Enhancements:
 *   1. ATR-based EQH/EQL clustering (from Pinnacle Structure Cipher)
 *   2. Liquidity pool strength (count of touches)
 *   3. Pool size classification (minor/major)
 *
 * Drop-in replacement for ict-agent/src/engine/liquidityDetector.js
 */

import { EQH_TOLERANCE, EQH_MIN_TOUCHES, MACRO_LOOKBACK, SWING_LOOKBACK_MIN, SWING_LOOKBACK_MACRO } from './engineConfig';
import { AdvancedSRDetector } from './advancedSR';

const LIQ_LOOKBACK = MACRO_LOOKBACK; 
const SWING_LOOKBACK = SWING_LOOKBACK_MIN; 

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

export function detectLiquidity(candles) {
  if (!candles || candles.length < 10) return { bsl: [], ssl: [], pools: [], macroHighs: [], macroLows: [] };
  const slice = candles.slice(-LIQ_LOOKBACK);
  const atr = calcATR(slice);
  const tolerance = atr * EQH_TOLERANCE;

  const bsl = [];
  const ssl = [];
  const lastClose = slice[slice.length - 1].close;

  // ── Find swing highs (BSL) and swing lows (SSL) ────────────────────────
  const swingHighs = [];
  const swingLows = [];

  for (let i = SWING_LOOKBACK; i < slice.length - SWING_LOOKBACK; i++) {
    const c = slice[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= SWING_LOOKBACK; j++) {
      if (slice[i - j].high >= c.high) isSwingHigh = false;
      if (slice[i + j].high >= c.high) isSwingHigh = false;
      if (slice[i - j].low <= c.low) isSwingLow = false;
      if (slice[i + j].low <= c.low) isSwingLow = false;
    }

    if (isSwingHigh) {
      swingHighs.push({ price: c.high, time: c.time, idx: i });
      if (c.high > lastClose) {
        bsl.push({ price: c.high, time: c.time, type: 'swing', swept: false });
      }
    }
    if (isSwingLow) {
      swingLows.push({ price: c.low, time: c.time, idx: i });
      if (c.low < lastClose) {
        ssl.push({ price: c.low, time: c.time, type: 'swing', swept: false });
      }
    }
  }

  // ── Find Macro Pivot Highs/Lows (Major Support/Resistance) ──────────
  // Now using AdvancedSRDetector (Pivot Clustering)
  const detector = new AdvancedSRDetector(15, 15, 0.005);
  const macroZones = detector.analyze(slice);
  
  const macroHighs = macroZones
    .filter(z => z.initialType === 'RES')
    .map(z => ({ price: z.price, time: z.startTime, pieces: z.touches, type: 'macro' }));
    
  const macroLows = macroZones
    .filter(z => z.initialType === 'SUP')
    .map(z => ({ price: z.price, time: z.startTime, pieces: z.touches, type: 'macro' }));


  // ── EQH/EQL Clustering (Pine Script: Pinnacle Structure Cipher) ────────
  // Group swing points within ATR * EQH_TOLERANCE into liquidity pools
  const pools = [];

  // Cluster equal highs
  const highClusters = clusterLevels(swingHighs.map((s) => s.price), tolerance);
  for (const cluster of highClusters) {
    if (cluster.count >= EQH_MIN_TOUCHES) {
      const avgPrice = cluster.sum / cluster.count;
      if (avgPrice > lastClose) {
        bsl.push({
          price: avgPrice,
          time: swingHighs[swingHighs.length - 1]?.time,
          type: 'equal',
          swept: false,
          touches: cluster.count,
        });
        pools.push({
          type: 'BSL',
          price: avgPrice,
          touches: cluster.count,
          strength: cluster.count >= 3 ? 'major' : 'minor',
        });
      }
    }
  }

  // Cluster equal lows
  const lowClusters = clusterLevels(swingLows.map((s) => s.price), tolerance);
  for (const cluster of lowClusters) {
    if (cluster.count >= EQH_MIN_TOUCHES) {
      const avgPrice = cluster.sum / cluster.count;
      if (avgPrice < lastClose) {
        ssl.push({
          price: avgPrice,
          time: swingLows[swingLows.length - 1]?.time,
          type: 'equal',
          swept: false,
          touches: cluster.count,
        });
        pools.push({
          type: 'SSL',
          price: avgPrice,
          touches: cluster.count,
          strength: cluster.count >= 3 ? 'major' : 'minor',
        });
      }
    }
  }

  // De-dup by price proximity
  const dedupLevels = (levels) => {
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const deduped = [];
    for (const lvl of sorted) {
      const last = deduped[deduped.length - 1];
      if (!last || Math.abs(lvl.price - last.price) / lvl.price > 0.002) {
        deduped.push(lvl);
      }
    }
    return deduped;
  };

  return {
    bsl: dedupLevels(bsl).slice(-6),
    ssl: dedupLevels(ssl).slice(-6),
    pools,
    macroHighs,
    macroLows,
  };
}

/**
 * Cluster price levels within tolerance
 */
function clusterLevels(prices, tolerance) {
  if (!prices.length) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters = [];
  let current = { sum: sorted[0], count: 1, min: sorted[0], max: sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const avg = current.sum / current.count;
    if (Math.abs(sorted[i] - avg) <= tolerance) {
      current.sum += sorted[i];
      current.count++;
      current.max = sorted[i];
    } else {
      clusters.push(current);
      current = { sum: sorted[i], count: 1, min: sorted[i], max: sorted[i] };
    }
  }
  clusters.push(current);
  return clusters;
}

/**
 * Detect liquidity sweep
 */
export function detectLiquiditySweep(candles) {
  if (!candles || candles.length < 5) return { bullSweep: false, bearSweep: false };

  const recent = candles.slice(-10);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  const { bsl, ssl } = detectLiquidity(candles);

  let bullSweep = false;
  let bearSweep = false;

  for (const s of ssl) {
    if (prev.low < s.price && last.close > s.price) {
      bullSweep = true;
      break;
    }
  }

  for (const b of bsl) {
    if (prev.high > b.price && last.close < b.price) {
      bearSweep = true;
      break;
    }
  }

  return { bullSweep, bearSweep, bsl, ssl };
}

/**
 * Get nearest BSL above and SSL below
 */
export function getNearestLiquidity(candles, price) {
  const { bsl, ssl } = detectLiquidity(candles);
  const nearBSL = bsl
    .filter((b) => b.price > price)
    .sort((a, b) => a.price - b.price)[0] || null;
  const nearSSL = ssl
    .filter((s) => s.price < price)
    .sort((a, b) => b.price - a.price)[0] || null;
  return { nearBSL, nearSSL };
}
