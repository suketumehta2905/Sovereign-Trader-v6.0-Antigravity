import { DEFAULT_WORKER_URL, LS_KEYS } from '../config/constants';
import { lsGet } from './localStorage';

function getWorkerUrl() {
  const settings = lsGet(LS_KEYS.SETTINGS, {});
  return (settings.workerUrl || DEFAULT_WORKER_URL).replace(/\/$/, '');
}

const TD_SYMBOL = {
  'XAUUSD=X': 'XAU/USD', 'XAGUSD=X': 'XAG/USD',
  'GC=F': 'XAU/USD', 'SI=F': 'XAG/USD',
  'CL=F': 'WTI/USD', 'NG=F': 'NGAS/USD',
};

const TD_INTERVAL = {
  '1m': '1min', '5m': '5min', '15m': '15min',
  '60m': '1h', '1h': '1h', '1d': '1day',
};

async function fetchFromTwelveData(sym, tf) {
  const settings = lsGet(LS_KEYS.SETTINGS, {});
  if (!settings.twelveKey) throw new Error('No TwelveData key');
  const symbol = TD_SYMBOL[sym.yf] || sym.id;
  const interval = TD_INTERVAL[tf] || '15min';
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=500&apikey=${settings.twelveKey}&format=JSON`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`TD HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'error' || data.code === 429) {
    if (data.message?.includes('credits') || data.code === 429) {
      throw new Error('TwelveData API Credits Exhausted');
    }
    throw new Error(data.message || 'TwelveData API Error');
  }
  if (!data.values) throw new Error('No values returned from TwelveData');
  return data.values
    .map((v) => ({
      time: Math.floor(new Date(v.datetime).getTime() / 1000),
      open: parseFloat(v.open), high: parseFloat(v.high),
      low: parseFloat(v.low), close: parseFloat(v.close),
      volume: parseFloat(v.volume) || 0,
    }))
    .filter((c) => !isNaN(c.open) && c.high >= c.low && c.high > 0)
    .sort((a, b) => a.time - b.time);
}

function parseCandles(data) {
  let candles = [];
  if (data?.chart?.result?.[0]) {
    const r = data.chart.result[0];
    const q = r.indicators?.quote?.[0] || {};
    candles = (r.timestamp || []).map((t, i) => ({
      time: t, open: q.open?.[i], high: q.high?.[i],
      low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] || 0,
    }));
  } else if (Array.isArray(data)) {
    candles = data;
  } else if (data?.candles) {
    const s = data.candles[0] || {};
    candles = 't' in s
      ? data.candles.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v || 0 }))
      : data.candles;
  } else if (data?.t) {
    candles = data.t.map((t, i) => ({
      time: t, open: data.o?.[i], high: data.h?.[i],
      low: data.l?.[i], close: data.c?.[i], volume: data.v?.[i] || 0,
    }));
  } else if (data?.timestamp) {
    const q = data.indicators?.quote?.[0] || {};
    candles = data.timestamp.map((t, i) => ({
      time: t, open: q.open?.[i], high: q.high?.[i],
      low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] || 0,
    }));
  }
  return candles
    .filter((c) => c && c.time != null && c.open != null && c.close != null)
    .map((c) => ({
      time: c.time > 1e10 ? Math.floor(c.time / 1000) : Math.floor(c.time),
      open: Number(c.open), high: Number(c.high),
      low: Number(c.low), close: Number(c.close), volume: Number(c.volume || 0),
    }))
    .filter((c) => !isNaN(c.open) && c.high >= c.low && c.high > 0)
    .sort((a, b) => a.time - b.time);
}

function parseQuote(data) {
  const q = data?.quoteResponse?.result?.[0] || data;
  const price = q.regularMarketPrice || q.price || q.c || 0;
  const prev = q.regularMarketPreviousClose || q.previousClose || q.pc || price;
  const change = q.regularMarketChange || q.change || (price - prev);
  const changePct = q.regularMarketChangePercent || q.changePct || (prev ? ((price - prev) / prev) * 100 : 0);
  return { price: Number(price), prevClose: Number(prev), change: Number(change), changePct: Number(changePct) };
}

// ── DHAN API PLACEHOLDERS ──────────────────────────────────────────────────
// User will inject their Dhan API logic here
async function fetchDhanPrice(sym) {
  const settings = lsGet(LS_KEYS.SETTINGS, {});
  if (!settings.dhanKey) throw new Error('No Dhan key configured');
  // TODO: Replace with actual Dhan API Call
  // Example return format:
  // return { price: 72000, prevClose: 71500, change: 500, changePct: 0.69 };
  throw new Error('Dhan API not implemented yet');
}

async function fetchDhanCandles(sym, tf, range) {
  const settings = lsGet(LS_KEYS.SETTINGS, {});
  if (!settings.dhanKey) throw new Error('No Dhan key configured');
  // TODO: Replace with actual Dhan API Call
  // Example return format: array of { time: unixSecs, open, high, low, close }
  throw new Error('Dhan API not implemented yet');
}

export let lastCandleSource = { source: 'none', label: 'No data', color: '#6b7280', spot: false };

export async function fetchPrice(sym) {
  const settings = lsGet(LS_KEYS.SETTINGS, {});
  
  // Route MCX symbols to Dhan if key exists
  if (sym.id.startsWith('MCX:')) {
    try {
      return await fetchDhanPrice(sym);
    } catch (e) { console.warn('Dhan price fetch failed:', e.message); }
  }

  if (settings.twelveKey) {
    try {
      const tdSym = TD_SYMBOL[sym.yf] || sym.id;
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(tdSym)}&apikey=${settings.twelveKey.trim()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.close && !data.status) {
        const price = parseFloat(data.close);
        const prev = parseFloat(data.previous_close) || price;
        if (price > 0) return { price, prevClose: prev, change: price - prev, changePct: prev ? ((price - prev) / prev) * 100 : 0 };
      }
    } catch {}
  }
  const tryWorker = async (ticker) => {
    const res = await fetch(`${getWorkerUrl()}?source=yf&sym=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const q = parseQuote(data);
    if (!q.price) throw new Error('zero price');
    return q;
  };
  try { return await tryWorker(sym.yf); } catch {}
  if (sym.yfCandle && sym.yfCandle !== sym.yf) {
    try { return await tryWorker(sym.yfCandle); } catch {}
  }
  throw new Error(`fetchPrice failed for ${sym.id}`);
}

export async function fetchCandles(sym, tf = '15m', range = '5d') {
  const settings = lsGet(LS_KEYS.SETTINGS, {});
  let candles = [];
  let usedSource = 'none';

  // Route MCX symbols to Dhan
  if (sym.id.startsWith('MCX:')) {
    try {
      candles = await fetchDhanCandles(sym, tf, range);
      if (candles.length > 0) usedSource = 'dhan';
    } catch {}
  }

  if (candles.length === 0 && settings.twelveKey) {
    try {
      candles = await fetchFromTwelveData(sym, tf);
      if (candles.length > 0) usedSource = 'twelvedata';
    } catch {}
  }

  if (candles.length === 0) {
    try {
      const ticker = sym.yfCandle || sym.yf;
      const url = `${getWorkerUrl()}?source=yf&sym=${encodeURIComponent(ticker)}&type=candle&tf=${tf}&range=${range}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      candles = parseCandles(data);
      if (candles.length > 0) usedSource = ticker.endsWith('=F') ? 'yahoo-futures' : 'yahoo-spot';
    } catch {}
  }

  lastCandleSource = usedSource === 'twelvedata'
    ? { source: 'twelvedata', label: 'Twelve Data', color: '#22c55e', spot: true }
    : usedSource === 'yahoo-spot'
    ? { source: 'yahoo-spot', label: 'Yahoo Spot', color: '#3b82f6', spot: true }
    : usedSource === 'yahoo-futures'
    ? { source: 'yahoo-futures', label: 'Yahoo Futures', color: '#f97316', spot: false }
    : usedSource === 'dhan'
    ? { source: 'dhan', label: 'Dhan (MCX)', color: '#f97316', spot: true }
    : { source: 'none', label: 'No data', color: '#ef4444', spot: false };

  return candles;
}

// ── HISTORICAL DATA FOR WFO ────────────────────────────────────────────────
export async function fetchHistory(sym, range = '2y') {
  const ticker = sym.yfCandle || sym.yf;
  const url = `${getWorkerUrl()}?source=yf&sym=${encodeURIComponent(ticker)}&type=candle&tf=1d&range=${range}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`History HTTP ${res.status}`);
  const data = await res.json();
  const rawCandles = parseCandles(data);
  return rawCandles;
}
