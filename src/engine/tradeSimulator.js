/**
 * Trade Simulator — used by Walk-Forward Optimization engine
 *
 * Given an array of signals (generated from in-sample analysis),
 * simulate how each trade would have performed on FORWARD candles
 * (out-of-sample period).
 *
 * Returns trades array and performance stats.
 */

import { calcPips } from '../utils/pipCalculations';

/**
 * Simulate a single trade on forward candles
 * @param {Object} signal  - { entry, sl, tp1, bias, symId }
 * @param {Array}  candles - Forward candles (OOS period)
 * @param {Object} sym     - Symbol config
 * @returns {Object} { result: 'WIN'|'LOSS'|'OPEN', pnlPips, exitPrice, barsHeld }
 */
function simulateTrade(signal, candles, sym) {
  if (!candles || candles.length === 0) return null;

  const { entry, sl, tp1, bias } = signal;
  const isLong = bias === 'LONG';

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    if (isLong) {
      // Check SL (low touches sl)
      if (c.low <= sl) {
        const pnl = calcPips(sym, entry, sl);
        return { result: 'LOSS', pnlPips: -pnl, exitPrice: sl, barsHeld: i + 1 };
      }
      // Check TP1 (high touches tp1)
      if (c.high >= tp1) {
        const pnl = calcPips(sym, entry, tp1);
        return { result: 'WIN', pnlPips: pnl, exitPrice: tp1, barsHeld: i + 1 };
      }
    } else {
      // Short: SL above, TP below
      if (c.high >= sl) {
        const pnl = calcPips(sym, entry, sl);
        return { result: 'LOSS', pnlPips: -pnl, exitPrice: sl, barsHeld: i + 1 };
      }
      if (c.low <= tp1) {
        const pnl = calcPips(sym, entry, tp1);
        return { result: 'WIN', pnlPips: pnl, exitPrice: tp1, barsHeld: i + 1 };
      }
    }
  }

  // Didn't hit SL or TP — still open at end of period
  const lastClose = candles[candles.length - 1].close;
  const pnl = isLong
    ? calcPips(sym, entry, lastClose)
    : calcPips(sym, lastClose, entry);
  return {
    result: 'OPEN',
    pnlPips: isLong ? (lastClose > entry ? pnl : -pnl) : (lastClose < entry ? pnl : -pnl),
    exitPrice: lastClose,
    barsHeld: candles.length,
  };
}

/**
 * Generate signals from candles using simplified ICT rules (for WFO in-sample)
 * Avoids circular import — uses raw candle math instead of full engine
 */
function generateSignalsFromCandles(candles, sym, minScore = 40) {
  const signals = [];
  const step = Math.max(1, Math.floor(candles.length / 20)); // Sample every N candles

  for (let i = 30; i < candles.length - 5; i += step) {
    const slice = candles.slice(0, i + 1);
    const price = slice[slice.length - 1].close;
    const highs = slice.slice(-20).map((c) => c.high);
    const lows  = slice.slice(-20).map((c) => c.low);
    const swHigh = Math.max(...highs);
    const swLow  = Math.min(...lows);
    const range  = swHigh - swLow;
    const equil  = (swHigh + swLow) / 2;

    let bias = 'NEUTRAL';
    let score = Math.floor(Math.random() * 30) + 30; // Base score 30-60

    if (price < equil - range * 0.1) { bias = 'LONG'; score += 15; }
    if (price > equil + range * 0.1) { bias = 'SHORT'; score += 15; }

    // Displacement check
    const last3 = slice.slice(-3);
    const bullBodies = last3.filter((c) => c.close > c.open).length;
    const bearBodies = last3.filter((c) => c.close < c.open).length;
    if (bullBodies >= 2 && bias === 'LONG') score += 10;
    if (bearBodies >= 2 && bias === 'SHORT') score += 10;

    if (score >= minScore && bias !== 'NEUTRAL') {
      const slAmt  = range * 0.04;
      const sl     = bias === 'LONG' ? price - slAmt : price + slAmt;
      const risk   = Math.abs(price - sl);
      const tp1    = bias === 'LONG' ? price + risk * 1.5 : price - risk * 1.5;

      signals.push({
        time:  slice[slice.length - 1].time,
        entry: price,
        sl, tp1, bias, score,
        symId: sym.id,
      });
    }
  }

  return signals;
}

/**
 * Simulate all trades from signals on OOS candles
 */
export function simulateTrades(signals, ooCandles, sym) {
  if (!signals || !ooCandles || !sym) return { trades: [], stats: defaultStats() };

  const trades = [];

  for (const sig of signals) {
    // Find candles after signal entry
    const fwdCandles = ooCandles.filter((c) => c.time > sig.time);
    if (fwdCandles.length < 2) continue;

    const result = simulateTrade(sig, fwdCandles, sym);
    if (!result) continue;

    trades.push({ ...sig, ...result });
  }

  return { trades, stats: calcStats(trades) };
}

function calcStats(trades) {
  if (!trades.length) return defaultStats();

  const closed = trades.filter((t) => t.result !== 'OPEN');
  const wins   = closed.filter((t) => t.result === 'WIN');
  const losses = closed.filter((t) => t.result === 'LOSS');

  const totalPips = trades.reduce((s, t) => s + (t.pnlPips || 0), 0);
  const winRate   = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgWin    = wins.length ? wins.reduce((s, t) => s + t.pnlPips, 0) / wins.length : 0;
  const avgLoss   = losses.length ? losses.reduce((s, t) => s + t.pnlPips, 0) / losses.length : 0;
  const profFact  = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 99 : 0;

  // Max drawdown
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.pnlPips || 0;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    total:    trades.length,
    wins:     wins.length,
    losses:   losses.length,
    winRate:  +winRate.toFixed(1),
    totalPips:+totalPips.toFixed(1),
    avgWin:   +avgWin.toFixed(1),
    avgLoss:  +avgLoss.toFixed(1),
    profFact: +profFact.toFixed(2),
    maxDD:    +maxDD.toFixed(1),
    profitable: totalPips > 0,
  };
}

function defaultStats() {
  return {
    total: 0, wins: 0, losses: 0, winRate: 0,
    totalPips: 0, avgWin: 0, avgLoss: 0,
    profFact: 0, maxDD: 0, profitable: false,
  };
}

export { generateSignalsFromCandles, calcStats };
