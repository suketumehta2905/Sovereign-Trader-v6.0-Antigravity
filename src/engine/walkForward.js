/**
 * Walk-Forward Optimization Engine (Pardo Method)
 *
 * 1. Download real historical daily candles (2y)
 * 2. Split into rolling windows: 70% IS, 30% OOS
 * 3. On IS: generate signals, simulate trades, measure perf
 * 4. On OOS: apply same signals, measure UNSEEN performance
 * 5. Roll forward, repeat N windows
 * 6. Compile all OOS results → robustness check
 *
 * WF Efficiency = OOS Return / IS Return × 100
 * Robust: profitable + WFE >= 50% + MaxDD < 40%
 */

import { generateSignalsFromCandles, simulateTrades, calcStats } from './tradeSimulator';
import { WFO_IS_RATIO } from '../config/constants';

const OOS_RATIO = 1 - WFO_IS_RATIO;

/**
 * Run Walk-Forward Optimization
 * @param {Array}  candles   - Full historical OHLCV candles
 * @param {Object} sym       - Symbol config
 * @param {Object} config    - { numWindows, minScore }
 * @param {Function} onProgress - (pct, msg) callback
 * @returns {Object} { runs, equityCurve, summary }
 */
export async function runWFO(candles, sym, config = {}, onProgress = null) {
  const { numWindows = 5, minScore = 40 } = config;

  if (!candles || candles.length < 100) {
    throw new Error('Need at least 100 candles for WFO');
  }

  const totalLen = candles.length;
  const windowSize = Math.floor(totalLen / (numWindows * OOS_RATIO));
  const isSize  = Math.floor(windowSize * WFO_IS_RATIO);
  const oosSize = Math.floor(windowSize * OOS_RATIO);

  const runs = [];
  let allOOSTrades = [];
  let globalEquity = 0;
  const equityCurve = [{ run: 0, equity: 0 }];

  for (let w = 0; w < numWindows; w++) {
    const startIdx = w * oosSize;
    const isEnd    = startIdx + isSize;
    const oosEnd   = isEnd + oosSize;

    if (oosEnd > totalLen) break;

    const isCandles  = candles.slice(startIdx, isEnd);
    const oosCandles = candles.slice(isEnd, oosEnd);

    if (onProgress) {
      onProgress(
        Math.round((w / numWindows) * 90),
        `Window ${w + 1}/${numWindows}: Analyzing ${isCandles.length} IS candles...`
      );
    }

    // Small async yield to avoid blocking UI
    await new Promise((r) => setTimeout(r, 10));

    // Generate signals on IS period
    const isSignals = generateSignalsFromCandles(isCandles, sym, minScore);
    const isResult  = simulateTrades(isSignals, isCandles, sym);

    // Apply same signal entry rules to OOS period
    const oosSignals = generateSignalsFromCandles(oosCandles, sym, minScore);
    const oosResult  = simulateTrades(oosSignals, oosCandles, sym);

    const isStats  = isResult.stats;
    const oosStats = oosResult.stats;

    // Walk Forward Efficiency
    const wfe = isStats.totalPips !== 0
      ? +((oosStats.totalPips / isStats.totalPips) * 100).toFixed(1)
      : 0;

    const runData = {
      window:    w + 1,
      isSize:    isCandles.length,
      oosSize:   oosCandles.length,
      isTrades:  isStats.total,
      isWinRate: isStats.winRate,
      isTotalPips: isStats.totalPips,
      oosTrades:   oosStats.total,
      oosWinRate:  oosStats.winRate,
      oosTotalPips:oosStats.totalPips,
      oosMaxDD:    oosStats.maxDD,
      wfe,
      profitable:  oosStats.profitable,
    };

    runs.push(runData);
    allOOSTrades = [...allOOSTrades, ...oosResult.trades];

    globalEquity += oosStats.totalPips;
    equityCurve.push({ run: w + 1, equity: +globalEquity.toFixed(1) });
  }

  if (onProgress) onProgress(95, 'Compiling results...');
  await new Promise((r) => setTimeout(r, 10));

  const overallStats = calcStats(allOOSTrades);
  const avgWFE = runs.length
    ? runs.reduce((s, r) => s + r.wfe, 0) / runs.length
    : 0;

  const robust =
    overallStats.profitable &&
    avgWFE >= 50 &&
    overallStats.maxDD < 40;

  const summary = {
    totalRuns:   runs.length,
    totalTrades: overallStats.total,
    winRate:     overallStats.winRate,
    totalPips:   overallStats.totalPips,
    maxDD:       overallStats.maxDD,
    avgWFE:      +avgWFE.toFixed(1),
    profitable:  overallStats.profitable,
    robust,
  };

  if (onProgress) onProgress(100, 'Complete!');

  return { runs, equityCurve, summary };
}
