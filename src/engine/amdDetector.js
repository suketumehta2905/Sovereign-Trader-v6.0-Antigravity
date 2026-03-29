/**
 * AMD Phase Detector — Accumulation, Manipulation, Distribution, Markup, Markdown
 *
 * Based on ICT / Wyckoff methodology as documented in "The Sovereign Trader":
 *
 *  ACCUMULATION  — Institutions quietly filling buy orders in a sideways range.
 *                  Equal highs & lows form. Price at discount. "The Quiet Harvest."
 *
 *  MANIPULATION  — Judas Swing / Stop Hunt. Price sweeps SSL or BSL to fill
 *                  institutional orders before the real move. "The Engineering of Consent."
 *
 *  DISTRIBUTION  — Institutions unloading at premium. Range-bound at highs.
 *                  Watch for UTAD (false breakout above highs). "The Strategic Unload."
 *
 *  MARKUP        — Expansion from Accumulation up to Distribution targets.
 *                  Ride the trend, buy pullbacks to OBs/FVGs in discount.
 *
 *  MARKDOWN      — Expansion from Distribution down to Accumulation targets.
 *                  Sell rallies to bearish OBs/FVGs in premium.
 */

const ATR_PERIOD = 14;

function calcATR(candles) {
  if (candles.length < ATR_PERIOD + 1) return candles[candles.length - 1]?.high - candles[candles.length - 1]?.low || 1;
  const slice = candles.slice(-(ATR_PERIOD + 1));
  const trs = slice.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = slice[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.slice(1).reduce((a, b) => a + b, 0) / ATR_PERIOD;
}

function getSessionIST(timestampSec) {
  // Convert Unix seconds → IST (UTC+5:30)
  const d = new Date(timestampSec * 1000);
  const istMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; // 330 = 5h30m
  const istHour = istMinutes / 60;

  if (istHour >= 23.5 || istHour < 5.5)  return { name: 'Asia',        icon: '🌏', color: '#a855f7' };
  if (istHour >= 5.5  && istHour < 10.5) return { name: 'London Open', icon: '🇬🇧', color: '#3b82f6' };
  if (istHour >= 10.5 && istHour < 12.5) return { name: 'NY Pre-Open', icon: '🇺🇸', color: '#60a5fa' };
  if (istHour >= 12.5 && istHour < 19)   return { name: 'NY Session',  icon: '🗽', color: '#22c55e' };
  if (istHour >= 19   && istHour < 21)   return { name: 'Dead Zone',   icon: '💤', color: '#6b7280' };
  return { name: 'Late NY / Asia', icon: '🌙', color: '#a855f7' };
}

/**
 * Detect equal highs or lows (liquidity pools building)
 * Returns true if 3+ candle highs/lows cluster within tolerance
 */
function detectEqualLevels(values, tolerance) {
  const counts = values.map((v) => values.filter((u) => Math.abs(u - v) <= tolerance).length);
  return Math.max(...counts) >= 3;
}

/**
 * Main AMD phase detection function.
 * @param {Array} candles — OHLCV array, sorted oldest→newest
 * @returns {Object} phase descriptor
 */
export function detectAMDPhase(candles) {
  if (!candles || candles.length < 30) return null;

  const recent  = candles.slice(-60);
  const last    = recent[recent.length - 1];
  const atr     = calcATR(recent);
  const session = getSessionIST(last.time);

  // ── Range (last 20 candles) ──────────────────────────────────────────────
  const range20    = recent.slice(-20);
  const rangeHigh  = Math.max(...range20.map((c) => c.high));
  const rangeLow   = Math.min(...range20.map((c) => c.low));
  const rangeSize  = rangeHigh - rangeLow || 0.01;

  // Position in range: 0 = bottom (discount), 1 = top (premium)
  const posInRange = Math.max(0, Math.min(1, (last.close - rangeLow) / rangeSize));

  // ── Volatility ───────────────────────────────────────────────────────────
  const avgVol5    = recent.slice(-5).reduce((s, c) => s + (c.high - c.low), 0) / 5;
  const volRatio   = atr > 0 ? avgVol5 / atr : 1;

  // ── Displacement (large body candle = institutional intent) ───────────────
  const last5bodies   = recent.slice(-5).map((c) => Math.abs(c.close - c.open));
  const hasDisplace   = last5bodies.some((b) => b > atr * 1.3);

  // ── Liquidity sweep detection ────────────────────────────────────────────
  // Bullish sweep: price dipped below prev 15-candle low then closed back above it
  const base15Low     = Math.min(...recent.slice(-20, -5).map((c) => c.low));
  const base15High    = Math.max(...recent.slice(-20, -5).map((c) => c.high));
  const recent5Low    = Math.min(...recent.slice(-5).map((c) => c.low));
  const recent5High   = Math.max(...recent.slice(-5).map((c) => c.high));

  const bullSweep = recent5Low  < base15Low  && last.close > base15Low;  // swept SSL, recovered
  const bearSweep = recent5High > base15High && last.close < base15High; // swept BSL, recovered

  // ── Equal highs / lows (liquidity pools) ────────────────────────────────
  const tolerance      = atr * 0.15;
  const recentHighs    = recent.slice(-15).map((c) => c.high);
  const recentLows     = recent.slice(-15).map((c) => c.low);
  const hasEqualHighs  = detectEqualLevels(recentHighs, tolerance);
  const hasEqualLows   = detectEqualLevels(recentLows,  tolerance);
  const hasEqualHL     = hasEqualHighs || hasEqualLows;

  // ── Net directional move (last 20 candles) ────────────────────────────────
  const oldest20    = recent[recent.length - 20];
  const netMove     = last.close - oldest20.close;
  const netMovePct  = atr > 0 ? Math.abs(netMove) / (atr * 8) : 0; // 0=flat, 1=strong trend

  // ── Phase scoring ─────────────────────────────────────────────────────────
  let phase, confidence, label, color, icon, description, details, bias;

  // Priority 1: MANIPULATION — sweep + displacement = highest probability signal
  if ((bullSweep || bearSweep) && hasDisplace) {
    phase       = 'manipulation';
    label       = 'MANIPULATION';
    icon        = '⚡';
    color       = '#e2b340';
    confidence  = Math.min(90, 75 + (hasDisplace ? 10 : 0) + (hasEqualHL ? 5 : 0));
    bias        = bullSweep ? 'LONG' : 'SHORT';
    description = bullSweep
      ? 'Judas Swing — SSL swept below previous lows. Institutions filled BUY orders. Expansion UP expected.'
      : 'Judas Swing — BSL swept above previous highs. Institutions filled SELL orders. Expansion DOWN expected.';
    details = [
      bullSweep
        ? `⬇ Sell-Side Liquidity (SSL) swept below ${rangeLow.toFixed(2)}`
        : `⬆ Buy-Side Liquidity (BSL) swept above ${rangeHigh.toFixed(2)}`,
      '⚡ Displacement candle confirms institutional entry',
      bullSweep ? '🎯 Look for Bullish OB / FVG in Discount for entry' : '🎯 Look for Bearish OB / FVG in Premium for entry',
      `📍 Session: ${session.name}`,
    ];
  }

  // Priority 2: MARKUP — strong bullish expansion from discount
  else if (netMove > 0 && netMovePct > 0.4 && posInRange > 0.55) {
    phase       = 'markup';
    label       = 'MARKUP';
    icon        = '🚀';
    color       = '#22c55e';
    confidence  = Math.min(85, 60 + Math.round(netMovePct * 30));
    bias        = 'LONG';
    description = 'Markup (Expansion Up) — Price being delivered to BSL targets. Institutions driving price to equal highs / previous swing highs.';
    details = [
      `📈 Strong bullish expansion: +${(netMovePct * 100).toFixed(0)}% of range`,
      `🎯 Draw on Liquidity: Previous Highs / Equal Highs above ${rangeHigh.toFixed(2)}`,
      'Enter on pullbacks to Bullish OBs / FVGs in Discount',
      `💰 Price in ${posInRange > 0.7 ? 'PREMIUM' : 'MID'} — wait for retracement before entry`,
    ];
  }

  // Priority 3: MARKDOWN — strong bearish expansion from premium
  else if (netMove < 0 && netMovePct > 0.4 && posInRange < 0.45) {
    phase       = 'markdown';
    label       = 'MARKDOWN';
    icon        = '📉';
    color       = '#ef4444';
    confidence  = Math.min(85, 60 + Math.round(netMovePct * 30));
    bias        = 'SHORT';
    description = 'Markdown (Expansion Down) — Price being delivered to SSL targets. Institutions driving price to equal lows / previous swing lows.';
    details = [
      `📉 Strong bearish expansion: −${(netMovePct * 100).toFixed(0)}% of range`,
      `🎯 Draw on Liquidity: Previous Lows / Equal Lows below ${rangeLow.toFixed(2)}`,
      'Enter shorts on pullbacks to Bearish OBs / FVGs in Premium',
      `🔴 Price in ${posInRange < 0.3 ? 'DISCOUNT' : 'MID'} — wait for retracement before shorting`,
    ];
  }

  // Priority 4: DISTRIBUTION — price at premium, range-bound at highs
  else if (posInRange > 0.65 && volRatio < 0.9) {
    phase       = 'distribution';
    label       = 'DISTRIBUTION';
    icon        = '🏔';
    color       = '#f97316';
    confidence  = Math.min(80, 55 + (hasEqualHighs ? 15 : 0) + (volRatio < 0.7 ? 10 : 0));
    bias        = 'SHORT';
    description = 'Distribution — Institutions unloading at Premium. Retail euphoria. Watch for UTAD (false breakout above highs) before Markdown begins.';
    details = [
      `🔴 Price at PREMIUM — top ${Math.round(posInRange * 100)}% of range`,
      hasEqualHighs
        ? `↔ Equal Highs forming at ${rangeHigh.toFixed(2)} — BSL pool (UTAD bait)`
        : 'Range forming at highs — Smart Money distributing',
      'UTAD (Upthrust After Distribution) imminent — false breakout above highs',
      '⚠ Do NOT buy breakouts here — this is the institutional exit',
    ];
  }

  // Priority 5: ACCUMULATION — low volatility, sideways, forming equal highs/lows
  else if (volRatio < 0.85 || (hasEqualHL && posInRange < 0.55)) {
    phase       = 'accumulation';
    label       = 'ACCUMULATION';
    icon        = '🌀';
    color       = '#3b82f6';
    confidence  = Math.min(80, 50 + (hasEqualHL ? 20 : 0) + (volRatio < 0.7 ? 10 : 0));
    bias        = 'LONG';
    description = 'Accumulation — Institutions quietly filling BUY orders. Price trapped in sideways range. Watch for Spring (Stop Hunt below lows) as entry signal.';
    details = [
      `🔵 Price at ${posInRange < 0.4 ? 'DISCOUNT' : 'EQUILIBRIUM'} — ${Math.round((1 - posInRange) * 100)}% from bottom`,
      hasEqualLows  ? `↔ Equal Lows at ${rangeLow.toFixed(2)} — SSL pool building (Spring target)` : '',
      hasEqualHighs ? `↔ Equal Highs at ${rangeHigh.toFixed(2)} — BSL pool building` : '',
      `⏳ Low volatility: ${(volRatio * 100).toFixed(0)}% of ATR — the "Quiet Harvest"`,
      '⚡ Wait for Spring: Stop Hunt below Equal Lows, then violent reversal up',
    ].filter(Boolean);
  }

  // Default: Consolidation / unclear
  else {
    phase       = 'consolidation';
    label       = 'CONSOLIDATION';
    icon        = '↔';
    color       = '#6b7280';
    confidence  = 40;
    bias        = 'NEUTRAL';
    description = 'Equilibrium — No clear institutional phase. Price at 50% of range. Wait for Kill Zone (London/NY Open) for directional sweep and entry.';
    details = [
      `Price at ${Math.round(posInRange * 100)}% of range — near equilibrium`,
      'No sweep, no strong displacement detected',
      'Wait for Kill Zone (London: 7:30–10:00 IST, NY: 18:00–20:30 IST)',
      `📍 Current session: ${session.name}`,
    ];
  }

  return {
    phase,
    label,
    icon,
    color,
    confidence,
    bias,
    description,
    details,
    session,
    meta: {
      posInRange:    Math.round(posInRange * 100),
      volRatio:      Math.round(volRatio * 100),
      bullSweep,
      bearSweep,
      hasDisplace,
      hasEqualHighs,
      hasEqualLows,
      rangeHigh,
      rangeLow,
      rangeSize:     Math.round(rangeSize * 100) / 100,
      atr:           Math.round(atr * 100) / 100,
      netMovePct:    Math.round(netMovePct * 100),
    },
  };
}
