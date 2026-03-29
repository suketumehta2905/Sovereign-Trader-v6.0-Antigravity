/**
 * ICT Analysis Engine — Phase 4 Institutional Upgrade
 *
 * Enhancements over original:
 *   1. OB strength-weighted pillar scoring (0–100 scale affects point allocation)
 *   2. Liquidity Pool confluence detection (EQH/EQL clusters)
 *   3. FVG ATR-filtered (micro-noise eliminated)
 *   4. Breaker Block awareness in penalty/anchor checks
 *
 * All 10 pillars + anchors + penalties preserved. Only scoring math enhanced.
 *
 * Drop-in replacement for ict-agent/src/engine/ictAnalysis.js
 */

import { detectOrderBlocks } from './orderBlockDetector';
import { detectFVGs } from './fvgDetector';
import { detectLiquidity, detectLiquiditySweep } from './liquidityDetector';
import { detectTrendlines } from './trendlineDetector';
import { getKillzoneScore } from '../utils/sessionDetection';

const SWING_N = 20;

// ── Utilities ───────────────────────────────────────────────────────────────

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

function swingHL(candles, n = SWING_N) {
  const slice = candles.slice(-n);
  const high = Math.max(...slice.map((c) => c.high));
  const low = Math.min(...slice.map((c) => c.low));
  return { high, low, range: high - low, equil: (high + low) / 2 };
}

function checkDisplacement(candles) {
  if (candles.length < 3) return { bull: false, bear: false };
  const slice = candles.slice(-5);
  const avgBody =
    slice.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / slice.length;

  const last3 = slice.slice(-3);
  let bullCount = 0, bearCount = 0;

  for (const c of last3) {
    const body = Math.abs(c.close - c.open);
    if (c.close > c.open && body > avgBody * 1.2) bullCount++;
    if (c.close < c.open && body > avgBody * 1.2) bearCount++;
  }

  return { bull: bullCount >= 2, bear: bearCount >= 2 };
}

function checkOTE(candles, price) {
  const { high, low, range } = swingHL(candles);
  if (range === 0) return { bull: false, bear: false };

  const bullOTE_top = high - range * 0.618;
  const bullOTE_bot = high - range * 0.786;
  const inBullOTE = price >= bullOTE_bot && price <= bullOTE_top;

  const bearOTE_bot = low + range * 0.618;
  const bearOTE_top = low + range * 0.786;
  const inBearOTE = price >= bearOTE_bot && price <= bearOTE_top;

  return { bull: inBullOTE, bear: inBearOTE, high, low, range };
}

function checkBOS(candles) {
  if (candles.length < SWING_N + 2) return { bull: false, bear: false };

  const lookback = candles.slice(-SWING_N - 2, -2);
  const recent = candles.slice(-2);
  const lastClose = recent[recent.length - 1].close;

  const swingHigh = Math.max(...lookback.map((c) => c.high));
  const swingLow = Math.min(...lookback.map((c) => c.low));

  return { bull: lastClose > swingHigh, bear: lastClose < swingLow, swingHigh, swingLow };
}

// ── Penalty System (Phase 1B — preserved from original) ────────────────────

const PENALTY_KILL_THRESHOLD = 35;

function checkPenaltyFactors({
  bias, price, candles, orderBlocks, fvgs,
  bsl, ssl, bullSweep, bearSweep,
  swingHigh, swingLow, range, tp1, atr,
}) {
  const penalties = [];
  let totalPenalty = 0;

  const addPenalty = (label, pts) => {
    penalties.push({ label, penalty: pts, score: -pts, type: 'penalty' });
    totalPenalty += pts;
  };

  // Penalty 1: HTF Counter-Trend (-15)
  if (candles.length >= 40) {
    const oldSlice = candles.slice(-40, -20);
    const recSlice = candles.slice(-20);
    const oldAvg = oldSlice.reduce((s, c) => s + c.close, 0) / oldSlice.length;
    const recAvg = recSlice.reduce((s, c) => s + c.close, 0) / recSlice.length;
    const trendBull = recAvg > oldAvg * 1.001;
    const trendBear = recAvg < oldAvg * 0.999;
    if (bias === 'LONG' && trendBear) addPenalty('HTF Counter-Trend (LONG vs bearish trend)', 15);
    if (bias === 'SHORT' && trendBull) addPenalty('HTF Counter-Trend (SHORT vs bullish trend)', 15);
  }

  // Penalty 2: Blocking OB in TP Path (-10)
  if (bias === 'LONG' && tp1 > price) {
    const blocked = orderBlocks.some((ob) =>
      ob.type === 'bearish' && ob.mitigation !== 'broken' && !ob.isBreaker &&
      ob.bottom > price && ob.bottom < tp1
    );
    if (blocked) addPenalty('Supply OB blocking TP path (ceiling)', 10);
  } else if (bias === 'SHORT' && tp1 < price) {
    const blocked = orderBlocks.some((ob) =>
      ob.type === 'bullish' && ob.mitigation !== 'broken' && !ob.isBreaker &&
      ob.top < price && ob.top > tp1
    );
    if (blocked) addPenalty('Demand OB blocking TP path (floor)', 10);
  }

  // Penalty 3: Opposing Liquidity Pool (-8)
  if (bias === 'LONG' && tp1 > price && !bullSweep) {
    const half = (tp1 - price) * 0.5;
    const bslInPath = bsl.some((b) => b.price > price && b.price < price + half);
    if (bslInPath) addPenalty('BSL pool in trade path (reversal risk)', 8);
  } else if (bias === 'SHORT' && tp1 < price && !bearSweep) {
    const half = (price - tp1) * 0.5;
    const sslInPath = ssl.some((s) => s.price < price && s.price > price - half);
    if (sslInPath) addPenalty('SSL pool in trade path (reversal risk)', 8);
  }

  // Penalty 4: Chasing Entry (-7)
  const chaseThreshold = atr ? atr * 3 : price * 0.02;
  if (bias === 'LONG') {
    const valid = orderBlocks.filter((o) => o.type === 'bullish' && o.mitigation !== 'broken');
    if (valid.length > 0) {
      const nearestTop = Math.max(...valid.map((o) => o.top));
      if ((price - nearestTop) > chaseThreshold) addPenalty('Chasing entry (far above Demand OB)', 7);
    }
  } else if (bias === 'SHORT') {
    const valid = orderBlocks.filter((o) => o.type === 'bearish' && o.mitigation !== 'broken');
    if (valid.length > 0) {
      const nearestBot = Math.min(...valid.map((o) => o.bottom));
      if ((nearestBot - price) > chaseThreshold) addPenalty('Chasing entry (far below Supply OB)', 7);
    }
  }

  // Penalty 5: Opposing FVG Headwind (-6)
  if (bias === 'LONG' && tp1 > price) {
    const headwind = fvgs.some((f) => f.type === 'bearish' && f.bottom > price && f.bottom < tp1);
    if (headwind) addPenalty('Bearish FVG headwind in TP path', 6);
  } else if (bias === 'SHORT' && tp1 < price) {
    const headwind = fvgs.some((f) => f.type === 'bullish' && f.top < price && f.top > tp1);
    if (headwind) addPenalty('Bullish FVG headwind in TP path', 6);
  }

  // Penalty 6: Equilibrium Zone Entry (-5)
  if (range > 0) {
    const pct = (price - swingLow) / range;
    if (pct >= 0.45 && pct <= 0.55) addPenalty('Entry in Equilibrium zone (no P/D edge)', 5);
  }

  // Penalty 7: Recent Opposing BOS (-8)
  if (candles.length >= 25) {
    const mid = candles.slice(-25, -12);
    const recent = candles.slice(-12);
    const midHigh = Math.max(...mid.map((c) => c.high));
    const midLow = Math.min(...mid.map((c) => c.low));
    const lastClose = recent[recent.length - 1].close;
    if (bias === 'SHORT' && lastClose > midHigh) addPenalty('Recent Bullish BOS conflicts with SHORT', 8);
    if (bias === 'LONG' && lastClose < midLow) addPenalty('Recent Bearish BOS conflicts with LONG', 8);
  }

  return { penalties, totalPenalty };
}

// ── Anchor System (Phase 1A — preserved) ────────────────────────────────────

function checkAnchorConditions({ bias, pctRange, price, orderBlocks, fvgs, disp, range, prox }) {
  if (bias === 'NEUTRAL') {
    return { passed: false, anchors: [{ label: 'No clear bias', passed: false }] };
  }

  const anchors = [];

  // Anchor 1: Price Delivery
  const proximity = prox || (range > 0 ? range * 0.015 : price * 0.005);
  let priceDelivery = false;

  if (bias === 'LONG') {
    const validOBs = orderBlocks.filter((o) => o.type === 'bullish' && o.mitigation !== 'broken');
    priceDelivery = validOBs.some((ob) =>
      (price >= ob.bottom - proximity && price <= ob.top + proximity)
    );
    if (!priceDelivery) {
      priceDelivery = fvgs.some((f) =>
        f.type === 'bullish' && price >= f.bottom && price <= f.top
      );
    }
  } else {
    const validOBs = orderBlocks.filter((o) => o.type === 'bearish' && o.mitigation !== 'broken');
    priceDelivery = validOBs.some((ob) =>
      (price >= ob.bottom - proximity && price <= ob.top + proximity)
    );
    if (!priceDelivery) {
      priceDelivery = fvgs.some((f) =>
        f.type === 'bearish' && price >= f.bottom && price <= f.top
      );
    }
  }

  anchors.push({
    label: bias === 'LONG' ? 'Anchor 1: Price at Demand OB/FVG' : 'Anchor 1: Price at Supply OB/FVG',
    passed: priceDelivery,
  });

  // Anchor 2: P/D Matrix
  const pdPassed =
    bias === 'LONG' ? pctRange < 0.55 :
    bias === 'SHORT' ? pctRange > 0.45 :
    false;

  anchors.push({
    label: bias === 'LONG'
      ? `Anchor 2: Discount Zone (${(pctRange * 100).toFixed(0)}% of range)`
      : `Anchor 2: Premium Zone (${(pctRange * 100).toFixed(0)}% of range)`,
    passed: pdPassed,
  });

  // Anchor 3: Displacement
  const dispPassed = bias === 'LONG' ? disp.bull : bias === 'SHORT' ? disp.bear : false;

  anchors.push({
    label: bias === 'LONG' ? 'Anchor 3: Bullish Displacement' : 'Anchor 3: Bearish Displacement',
    passed: dispPassed,
  });

  const passCount = anchors.filter((a) => a.passed).length;
  return { passed: passCount >= 2, anchors };
}

// ── Main Analysis ───────────────────────────────────────────────────────────

export function runICTAnalysis(candles, sym) {
  if (!candles || candles.length < 20) {
    return {
      score: 0, bias: 'NEUTRAL', confidence: 'LOW',
      entry: 0, sl: 0, tp1: 0, tp2: 0,
      factors: [], orderBlocks: [], fvgs: [], bsl: [], ssl: [],
      equil: 0, swingHigh: 0, swingLow: 0, pools: [],
      macroHighs: [], macroLows: [], trendlines: [],
    };
  }

  const price = candles[candles.length - 1].close;
  const { high: swingHigh, low: swingLow, equil } = swingHL(candles);
  const range = swingHigh - swingLow;

  const atr = calcATR(candles, 14);
  const prox = Math.max(atr * 1.2, range * 0.015);

  let bullScore = 0, bearScore = 0;
  const factors = [];

  // ── Pillar 1: Market Structure (BOS) — max 15 ──
  const bos = checkBOS(candles);
  if (bos.bull) { bullScore += 15; factors.push({ label: 'BOS (Bullish)', score: 15, type: 'bull' }); }
  if (bos.bear) { bearScore += 15; factors.push({ label: 'BOS (Bearish)', score: 15, type: 'bear' }); }

  // ── Pillar 2: Order Blocks — max 12, STRENGTH-WEIGHTED ──
  const orderBlocks = detectOrderBlocks(candles);
  const nearBullOB = orderBlocks.filter((o) => o.type === 'bullish').slice(-1)[0];
  const nearBearOB = orderBlocks.filter((o) => o.type === 'bearish').slice(-1)[0];

  if (nearBullOB && price >= nearBullOB.bottom && price <= nearBullOB.top + prox) {
    // Weight by strength: institutional OBs get full 12, weaker OBs get proportionally less
    const pts = nearBullOB.institutional ? Math.round(12 * (nearBullOB.strength / 100)) : 6;
    const clampedPts = Math.max(4, Math.min(12, pts)); // Floor 4, cap 12
    bullScore += clampedPts;
    const tag = nearBullOB.isBreaker ? 'At Bullish Breaker' : nearBullOB.institutional ? 'At Institutional Bull OB' : 'At Bullish OB';
    factors.push({ label: `${tag} (S:${nearBullOB.strength})`, score: clampedPts, type: 'bull' });
  } else if (nearBullOB && Math.abs(price - nearBullOB.top) < prox) {
    bullScore += 6; factors.push({ label: 'Near Bullish OB', score: 6, type: 'bull' });
  }

  if (nearBearOB && price >= nearBearOB.bottom - prox && price <= nearBearOB.top) {
    const pts = nearBearOB.institutional ? Math.round(12 * (nearBearOB.strength / 100)) : 6;
    const clampedPts = Math.max(4, Math.min(12, pts));
    bearScore += clampedPts;
    const tag = nearBearOB.isBreaker ? 'At Bearish Breaker' : nearBearOB.institutional ? 'At Institutional Bear OB' : 'At Bearish OB';
    factors.push({ label: `${tag} (S:${nearBearOB.strength})`, score: clampedPts, type: 'bear' });
  } else if (nearBearOB && Math.abs(price - nearBearOB.bottom) < prox) {
    bearScore += 6; factors.push({ label: 'Near Bearish OB', score: 6, type: 'bear' });
  }

  // ── Pillar 3: Fair Value Gaps — max 10 ──
  const fvgs = detectFVGs(candles);
  const bullFVG = fvgs.filter((f) => f.type === 'bullish').slice(-1)[0];
  const bearFVG = fvgs.filter((f) => f.type === 'bearish').slice(-1)[0];

  if (bullFVG && price >= bullFVG.bottom && price <= bullFVG.top) {
    bullScore += 10; factors.push({ label: `In Bullish FVG (${bullFVG.gapATR}x ATR)`, score: 10, type: 'bull' });
  } else if (bullFVG && Math.abs(price - bullFVG.ce) < prox * 0.5) {
    bullScore += 6; factors.push({ label: 'Near FVG CE (Bull)', score: 6, type: 'bull' });
  }

  if (bearFVG && price >= bearFVG.bottom && price <= bearFVG.top) {
    bearScore += 10; factors.push({ label: `In Bearish FVG (${bearFVG.gapATR}x ATR)`, score: 10, type: 'bear' });
  } else if (bearFVG && Math.abs(price - bearFVG.ce) < prox * 0.5) {
    bearScore += 6; factors.push({ label: 'Near FVG CE (Bear)', score: 6, type: 'bear' });
  }

  // ── Pillar 4: Liquidity Sweeps — max 11 ──
  const { bullSweep, bearSweep } = detectLiquiditySweep(candles);
  if (bullSweep) { bullScore += 11; factors.push({ label: 'SSL Swept (Bullish)', score: 11, type: 'bull' }); }
  if (bearSweep) { bearScore += 11; factors.push({ label: 'BSL Swept (Bearish)', score: 11, type: 'bear' }); }

  const { bsl: bslAll, ssl: sslAll, pools, macroHighs, macroLows } = detectLiquidity(candles);
  const nearSSL = sslAll.filter((s) => Math.abs(price - s.price) < prox).length > 0;
  const nearBSL = bslAll.filter((b) => Math.abs(price - b.price) < prox).length > 0;
  if (nearSSL && !bullSweep) { bullScore += 4; factors.push({ label: 'Near SSL (Potential Bull)', score: 4, type: 'bull' }); }
  if (nearBSL && !bearSweep) { bearScore += 4; factors.push({ label: 'Near BSL (Potential Bear)', score: 4, type: 'bear' }); }

  // ── Pillar 4b: Liquidity Pool Confluence (NEW — from EQH/EQL clustering) ──
  for (const pool of pools) {
    if (pool.strength === 'major') {
      if (pool.type === 'SSL' && Math.abs(price - pool.price) < prox) {
        bullScore += 5;
        factors.push({ label: `Major SSL Pool (${pool.touches} touches)`, score: 5, type: 'bull' });
      }
      if (pool.type === 'BSL' && Math.abs(price - pool.price) < prox) {
        bearScore += 5;
        factors.push({ label: `Major BSL Pool (${pool.touches} touches)`, score: 5, type: 'bear' });
      }
    }
  }

  // ── Pillar 5: Premium/Discount — max 7 ──
  const pctRange = range > 0 ? (price - swingLow) / range : 0.5;
  if (pctRange < 0.35) {
    bullScore += 7; factors.push({ label: 'Discount Zone (Bull)', score: 7, type: 'bull' });
  } else if (pctRange < 0.5) {
    bullScore += 3; factors.push({ label: 'Below Equilibrium', score: 3, type: 'bull' });
  } else if (pctRange > 0.65) {
    bearScore += 7; factors.push({ label: 'Premium Zone (Bear)', score: 7, type: 'bear' });
  } else if (pctRange > 0.5) {
    bearScore += 3; factors.push({ label: 'Above Equilibrium', score: 3, type: 'bear' });
  }

  // ── Pillar 6: Session/Killzone — max 8 ──
  const kzScore = getKillzoneScore();
  if (kzScore > 0) {
    const kzBonus = Math.min(8, kzScore + 2);
    bullScore += kzBonus;
    bearScore += kzBonus;
    factors.push({ label: 'Active Killzone', score: kzBonus, type: 'both' });
  }

  // ── Pillar 7: OTE Zone — max 9 ──
  const ote = checkOTE(candles, price);
  if (ote.bull) { bullScore += 9; factors.push({ label: 'OTE Zone (Bullish)', score: 9, type: 'bull' }); }
  if (ote.bear) { bearScore += 9; factors.push({ label: 'OTE Zone (Bearish)', score: 9, type: 'bear' }); }

  // ── Pillar 8: Displacement — max 10 ──
  const disp = checkDisplacement(candles);
  if (disp.bull) { bullScore += 10; factors.push({ label: 'Bullish Displacement', score: 10, type: 'bull' }); }
  if (disp.bear) { bearScore += 10; factors.push({ label: 'Bearish Displacement', score: 10, type: 'bear' }); }

  // ── Pillar 9: Macro Trendlines — max 10 ──
  const trendlines = detectTrendlines(candles);
  const bullTL = trendlines.find(t => t.type === 'support');
  const bearTL = trendlines.find(t => t.type === 'resistance');
  if (bullTL && Math.abs(price - (bullTL.p2.y + bullTL.slope * (candles.length - 1 - bullTL.p2.x))) < prox) {
    bullScore += 10; factors.push({ label: 'At Support Trendline', score: 10, type: 'bull' });
  }
  if (bearTL && Math.abs(price - (bearTL.p2.y + bearTL.slope * (candles.length - 1 - bearTL.p2.x))) < prox) {
    bearScore += 10; factors.push({ label: 'At Resistance Trendline', score: 10, type: 'bear' });
  }

  // ── Determine bias & total score ──
  let bias = 'NEUTRAL';
  let score = 0;

  if (bullScore > bearScore + 2) {
    bias = 'LONG';
    score = bullScore;
  } else if (bearScore > bullScore + 2) {
    bias = 'SHORT';
    score = bearScore;
  } else {
    score = Math.max(bullScore, bearScore);
  }

  // ── Anchor gate ──
  const { passed: anchorsPassed, anchors } = checkAnchorConditions({
    bias, pctRange, price, orderBlocks, fvgs, disp, range, prox,
  });

  if (!anchorsPassed) {
    const failedLabels = anchors.filter((a) => !a.passed).map((a) => a.label);
    return {
      score: 0, bias: 'NEUTRAL', confidence: 'LOW',
      anchors, anchorsPassed: false, anchorFailed: failedLabels,
      entry: 0, sl: 0, tp1: 0, tp2: 0,
      factors: [
        ...factors,
        ...failedLabels.map((lbl) => ({ label: `X ${lbl}`, score: 0, type: 'reject' })),
      ],
      orderBlocks, fvgs,
      bsl: bslAll, ssl: sslAll, pools,
      bullScore, bearScore,
      macroHighs, macroLows, trendlines: [],
    };
  }

  anchors.forEach((a) => {
    factors.push({ label: `OK ${a.label}`, score: 0, type: 'anchor' });
  });

  // ── Entry/SL/TP calculation ──
  let entry = price;
  let sl = 0, tp1 = 0, tp2 = 0;

  if (bias === 'LONG') {
    const demandOB = orderBlocks.filter((o) => o.type === 'bullish' && o.mitigation !== 'broken').slice(-1)[0];
    sl = demandOB ? demandOB.bottom - range * 0.005 : swingLow - range * 0.03;
    const risk = Math.max(entry - sl, price * 0.001);
    tp1 = entry + risk * 1.5;
    tp2 = entry + risk * 3.0;
  } else if (bias === 'SHORT') {
    const supplyOB = orderBlocks.filter((o) => o.type === 'bearish' && o.mitigation !== 'broken').slice(-1)[0];
    sl = supplyOB ? supplyOB.top + range * 0.005 : swingHigh + range * 0.03;
    const risk = Math.max(sl - entry, price * 0.001);
    tp1 = entry - risk * 1.5;
    tp2 = entry - risk * 3.0;
  }

  // ── Penalty evaluation ──
  const { penalties, totalPenalty } = checkPenaltyFactors({
    bias, price, candles, orderBlocks, fvgs,
    bsl: bslAll, ssl: sslAll,
    bullSweep, bearSweep,
    swingHigh, swingLow, range, tp1, atr,
  });

  penalties.forEach((p) => factors.push(p));

  if (totalPenalty >= PENALTY_KILL_THRESHOLD) {
    return {
      score: 0, bias: 'NEUTRAL', confidence: 'LOW',
      anchors, anchorsPassed: true, penaltyKilled: true,
      penaltyTotal: totalPenalty, penalties,
      bullScore, bearScore,
      macroHighs, macroLows, trendlines,
    };
  }

  const penalisedScore = Math.max(0, score - totalPenalty);
  const normalised = Math.min(100, Math.round((penalisedScore / 82) * 100));
  score = normalised;

  const confidence =
    score >= 70 ? 'HIGH' :
    score >= 50 ? 'MEDIUM' : 'LOW';

  return {
    score, bias, confidence,
    bullScore, bearScore,
    penalisedRaw: penalisedScore,
    penaltyTotal: totalPenalty,
    penalties, anchors,
    anchorsPassed: true,
    penaltyKilled: false,
    entry: +entry.toFixed(sym.priceDigits || 2),
    sl: +sl.toFixed(sym.priceDigits || 2),
    tp1: +tp1.toFixed(sym.priceDigits || 2),
    tp2: +tp2.toFixed(sym.priceDigits || 2),
    factors, orderBlocks, fvgs,
    bsl: bslAll, ssl: sslAll, pools,
    equil, swingHigh, swingLow, pctRange,
    macroHighs, macroLows, trendlines,
  };
}
