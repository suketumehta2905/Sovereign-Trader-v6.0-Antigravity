import React, { useState, useCallback, useRef, useEffect } from 'react';
import { SYMBOLS } from '../config/constants';
import { fetchHistory } from '../utils/dataFetchers';
import { runWFO } from '../engine/walkForward';
import { supabase } from '../supabaseClient';

function StatBox({ label, value, valueColor = 'var(--t1)' }) {
  return (
    <div className="stat-box">
      <div className="stat-value" style={{ color: valueColor, fontWeight: 800 }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ── CSV Parser ─────────────────────────────────────────────────────────────
// Supports TradingView export (time,open,high,low,close,volume)
// and Yahoo Finance export (Date,Open,High,Low,Close,Adj Close,Volume)
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((s) => s.trim().replace(/"/g, '').toLowerCase());

  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const timeIdx  = idx(['time', 'date', 'datetime', 'timestamp']);
  const openIdx  = idx(['open']);
  const highIdx  = idx(['high']);
  const lowIdx   = idx(['low']);
  const closeIdx = idx(['close']); // 'close' before 'adj close'
  const volIdx   = idx(['volume', 'vol']);

  if (timeIdx < 0 || openIdx < 0 || highIdx < 0 || lowIdx < 0 || closeIdx < 0) return [];

  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',').map((s) => s.trim().replace(/"/g, ''));

    const rawTime = cols[timeIdx];
    let ts;
    if (/^\d{9,12}$/.test(rawTime)) {
      // Unix timestamp (seconds if 10 digits, ms if 13)
      ts = rawTime.length >= 12 ? Math.floor(parseInt(rawTime) / 1000) : parseInt(rawTime);
    } else {
      // Date string like "2024-01-02" or "2024-01-02 16:00:00"
      ts = Math.floor(new Date(rawTime).getTime() / 1000);
    }
    if (!ts || isNaN(ts) || ts <= 0) continue;

    const o = parseFloat(cols[openIdx]);
    const h = parseFloat(cols[highIdx]);
    const l = parseFloat(cols[lowIdx]);
    const c = parseFloat(cols[closeIdx]);
    const v = volIdx >= 0 ? parseFloat(cols[volIdx]) || 0 : 0;

    if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) continue;
    if (h < l || h <= 0) continue;

    candles.push({ time: ts, open: o, high: h, low: l, close: c, volume: v });
  }

  return candles.sort((a, b) => a.time - b.time);
}

// ── Component ───────────────────────────────────────────────────────────────
export default function WalkForwardPage() {
  const [sym,      setSym]      = useState('XAUUSD');
  const [range,    setRange]    = useState('2y');
  const [windows,  setWindows]  = useState(8);
  const [minScore, setMinScore] = useState(40);

  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [progMsg,  setProgMsg]  = useState('');
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState('');

  // CSV & Cloud state
  const [csvCandles, setCsvCandles] = useState(null);
  const [csvInfo,    setCsvInfo]    = useState('');
  const [cloudDatasets, setCloudDatasets] = useState([]);
  const [savingCloud, setSavingCloud] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    // Load available cloud datasets on mount
    supabase.from('st_wfo_datasets').select('id, symbol, range_desc, count, created_at')
      .order('created_at', { ascending: false })
      .then(res => { if (res.data) setCloudDatasets(res.data); });
  }, []);

  const symObj = SYMBOLS.find((s) => s.id === sym) || SYMBOLS[0];

  const onProgress = useCallback((pct, msg) => {
    setProgress(pct);
    setProgMsg(msg);
  }, []);

  // Handle CSV file upload
  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvInfo('Parsing…');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const candles = parseCSV(ev.target.result);
      if (candles.length < 50) {
        setCsvInfo(`✕ Only ${candles.length} rows parsed. Check CSV format (need: time/date, open, high, low, close columns).`);
        setCsvCandles(null);
      } else {
        const from = new Date(candles[0].time * 1000).toLocaleDateString('en-IN');
        const to   = new Date(candles[candles.length - 1].time * 1000).toLocaleDateString('en-IN');
        const years = ((candles[candles.length - 1].time - candles[0].time) / (365.25 * 86400)).toFixed(1);
        setCsvCandles(candles);
        setCsvInfo(`✓ ${candles.length} candles loaded — ${from} → ${to} (${years} years)`);
      }
    };
    reader.onerror = () => setCsvInfo('✕ Could not read file.');
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  const clearCSV = () => {
    setCsvCandles(null);
    setCsvInfo('');
  };

  const saveToCloud = async () => {
    if (!csvCandles || csvCandles.length < 50) return;
    setSavingCloud(true);
    const from = new Date(csvCandles[0].time * 1000).toLocaleDateString('en-IN');
    const to   = new Date(csvCandles[csvCandles.length - 1].time * 1000).toLocaleDateString('en-IN');
    const payload = {
      id: `${sym}_${Date.now()}`,
      symbol: sym,
      range_desc: `${from} to ${to}`,
      count: csvCandles.length,
      candles: csvCandles
    };
    try {
      await supabase.from('st_wfo_datasets').insert([payload]);
      setCsvInfo(`✓ Saved to Cloud! (${csvCandles.length} candles)`);
      setCloudDatasets([payload, ...cloudDatasets]);
    } catch { setCsvInfo('✕ Failed to save to cloud.'); }
    setSavingCloud(false);
  };

  const loadFromCloud = async (datasetId) => {
    setCsvInfo('Downloading from Cloud...');
    try {
      const res = await supabase.from('st_wfo_datasets').select('*').eq('id', datasetId).single();
      if (res.data && res.data.candles) {
        setCsvCandles(res.data.candles);
        setSym(res.data.symbol);
        setCsvInfo(`✓ Loaded Cloud Dataset: ${res.data.range_desc} (${res.data.count} rows)`);
      }
    } catch { setCsvInfo('✕ Cloud download failed.'); }
  };

  const runAnalysis = async () => {
    setRunning(true);
    setError('');
    setResult(null);
    setProgress(0);

    try {
      let candles;

      if (csvCandles) {
        // Use uploaded CSV data
        setProgMsg(`Using uploaded CSV — ${csvCandles.length} candles`);
        candles = csvCandles;
      } else {
        // Fetch from API
        setProgMsg('Downloading historical data from API…');
        candles = await fetchHistory(symObj, range);
        if (!candles || candles.length < 100) {
          throw new Error(
            `API returned ${candles?.length || 0} candles — not enough for WFO.\n\n` +
            `Fix: Upload a CSV file (see instructions below) or check your Worker URL in Settings.`
          );
        }
      }

      setProgMsg(`${candles.length} candles ready. Running WFO with ${windows} windows…`);

      const wfoResult = await runWFO(
        candles, symObj,
        { numWindows: windows, minScore },
        onProgress
      );

      setResult(wfoResult);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const robustColor = result?.summary?.robust ? 'var(--bull)' : 'var(--bear)';

  return (
    <div>
      <div className="page-header">
        <h2>Walk-Forward Optimization</h2>
        <p>Validate ICT strategy robustness using Pardo's WFO methodology on real historical data</p>
      </div>

      {/* ── Data Source ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 14 }}>
          Data Source
          <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 400, color: 'var(--t2)' }}>
            Upload CSV for best results (10+ years). API fetch is limited and may fail.
          </span>
        </div>

        {/* Upload area */}
        <div style={{ border: `2px dashed ${csvCandles ? 'var(--bull)' : 'var(--s4)'}`, borderRadius: 8, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleCSVUpload} style={{ display: 'none' }} />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} style={{ minWidth: 160 }}>{csvCandles ? '↺ Replace CSV' : '↑ Upload CSV File'}</button>
          
          {csvInfo ? (
            <span style={{ fontSize: 13, color: csvCandles ? 'var(--bull)' : 'var(--bear)', flex: 1 }}>{csvInfo}</span>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--t2)', flex: 1 }}>No file loaded — will try API fetch instead</span>
          )}

          {csvCandles && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-sm" onClick={saveToCloud} disabled={savingCloud} style={{ background: '#3b82f6', color: '#fff', border: 'none' }}>
                {savingCloud ? '☁ Saving...' : '☁ Save to Cloud'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={clearCSV} style={{ color: 'var(--bear)' }}>✕ Clear</button>
            </div>
          )}
        </div>

        {/* Cloud Datasets */}
        {cloudDatasets.length > 0 && !csvCandles && (
          <div style={{ marginTop: 12, padding: '12px 16px', background: 'var(--s2)', borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>☁ Available Cloud Datasets:</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {cloudDatasets.map(ds => (
                <button key={ds.id} className="btn btn-ghost btn-sm" onClick={() => loadFromCloud(ds.id)} style={{ border: '1px solid var(--s4)' }}>
                  ↓ {ds.symbol} ({ds.count} rows)
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Config ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="label" style={{ marginBottom: 14 }}>Configuration</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 16, alignItems: 'end' }}>
          <div className="input-group">
            <label>Symbol</label>
            <select className="input" value={sym} onChange={(e) => { setSym(e.target.value); clearCSV(); }}>
              {SYMBOLS.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.id} — {s.name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label>API Range {csvCandles && <span style={{ color: 'var(--t3)', fontSize: 11 }}>(ignored — using CSV)</span>}</label>
            <select className="input" value={range} onChange={(e) => setRange(e.target.value)} disabled={!!csvCandles}>
              <option value="1y">1 Year</option>
              <option value="2y">2 Years</option>
              <option value="5y">5 Years</option>
              <option value="max">Max</option>
            </select>
          </div>
          <div className="input-group">
            <label>WFO Windows</label>
            <input
              className="input" type="number" min="3" max="20"
              value={windows} onChange={(e) => setWindows(+e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>Min Signal Score</label>
            <input
              className="input" type="number" min="20" max="70" step="5"
              value={minScore} onChange={(e) => setMinScore(+e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={runAnalysis}
            disabled={running}
            style={{ height: 46 }}
          >
            {running ? '⟳ Running…' : '▶ Run WFO'}
          </button>
        </div>

        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
          <strong>Method:</strong> 70% In-Sample | 30% Out-of-Sample rolling windows.
          Robustness: Profitable + WF Efficiency ≥ 50% + Max DD &lt; 40%.
          {csvCandles && (
            <span style={{ marginLeft: 12, color: 'var(--bull)' }}>
              ☁ Using uploaded CSV — {csvCandles.length} daily bars
            </span>
          )}
        </div>
      </div>

      {/* ── Progress ─────────────────────────────────────────────────── */}
      {running && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{progMsg}</span>
            <span className="mono" style={{ color: 'var(--accent)' }}>{progress}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--s3)', borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%', width: `${progress}%`,
                background: 'var(--accent)',
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          padding: '16px 20px', background: 'var(--bear-bg)',
          border: '1px solid var(--bear)', borderRadius: 8,
          color: 'var(--bear)', fontSize: 13, marginBottom: 24,
          whiteSpace: 'pre-line', lineHeight: 1.7,
        }}>
          ✕ {error}
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────── */}
      {result && (
        <>
          {/* Summary */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div
                style={{
                  padding: '8px 20px',
                  background: result.summary.robust ? 'var(--bull-bg)' : 'var(--bear-bg)',
                  border: `1px solid ${result.summary.robust ? 'var(--bull)' : 'var(--bear)'}`,
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 15,
                  color: robustColor,
                }}
              >
                {result.summary.robust ? '✓ ROBUST STRATEGY' : '✗ NOT ROBUST'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--t2)' }}>
                {result.summary.totalRuns} windows | {result.summary.totalTrades} OOS trades
              </div>
            </div>

            <div className="stats-grid-4">
              <StatBox
                label="OOS Win Rate"
                value={`${result.summary.winRate}%`}
                valueColor={result.summary.winRate >= 55 ? 'var(--bull)' : 'var(--accent)'}
              />
              <StatBox
                label="OOS Total Pips"
                value={`${result.summary.totalPips > 0 ? '+' : ''}${result.summary.totalPips}`}
                valueColor={result.summary.totalPips > 0 ? 'var(--bull)' : 'var(--bear)'}
              />
              <StatBox
                label="Avg WF Efficiency"
                value={`${result.summary.avgWFE}%`}
                valueColor={result.summary.avgWFE >= 50 ? 'var(--bull)' : 'var(--bear)'}
              />
              <StatBox
                label="Max Drawdown"
                value={`${result.summary.maxDD}%`}
                valueColor={result.summary.maxDD < 40 ? 'var(--bull)' : 'var(--bear)'}
              />
            </div>
          </div>

          {/* Equity Curve */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="label" style={{ marginBottom: 16 }}>OOS Equity Curve (Pips)</div>
            <div style={{ position: 'relative', height: 180 }}>
              <EquityCurve data={result.equityCurve} />
            </div>
          </div>

          {/* Per-window table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--s3)', fontWeight: 600 }}>
              Window Results
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr>
                  <th>Window</th>
                  <th>IS Bars</th><th>IS Trades</th><th>IS WR%</th><th>IS Pips</th>
                  <th>OOS Bars</th><th>OOS Trades</th><th>OOS WR%</th><th>OOS Pips</th>
                  <th>Max DD%</th><th>WFE%</th><th>Result</th>
                </tr></thead>
                <tbody>
                  {result.runs.map((r) => (
                    <tr key={r.window}>
                      <td className="mono" style={{ fontWeight: 700 }}>#{r.window}</td>
                      <td className="mono">{r.isSize}</td>
                      <td className="mono">{r.isTrades}</td>
                      <td className="mono" style={{ color: r.isWinRate >= 55 ? 'var(--bull)' : 'var(--t2)' }}>
                        {r.isWinRate}%
                      </td>
                      <td className="mono" style={{ color: r.isTotalPips >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                        {r.isTotalPips > 0 ? '+' : ''}{r.isTotalPips}
                      </td>
                      <td className="mono">{r.oosSize}</td>
                      <td className="mono">{r.oosTrades}</td>
                      <td className="mono" style={{ color: r.oosWinRate >= 55 ? 'var(--bull)' : 'var(--t2)' }}>
                        {r.oosWinRate}%
                      </td>
                      <td className="mono" style={{ color: r.oosTotalPips >= 0 ? 'var(--bull)' : 'var(--bear)', fontWeight: 700 }}>
                        {r.oosTotalPips > 0 ? '+' : ''}{r.oosTotalPips}
                      </td>
                      <td className="mono" style={{ color: r.oosMaxDD < 40 ? 'var(--bull)' : 'var(--bear)' }}>
                        {r.oosMaxDD}%
                      </td>
                      <td className="mono" style={{ color: r.wfe >= 50 ? 'var(--bull)' : 'var(--bear)' }}>
                        {r.wfe}%
                      </td>
                      <td>
                        <span className={`tag tag-${r.profitable ? 'bull' : 'bear'}`}>
                          {r.profitable ? '✓' : '✗'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Simple SVG equity curve
function EquityCurve({ data }) {
  if (!data || data.length < 2) return <div style={{ color: 'var(--t3)', textAlign: 'center', paddingTop: 60 }}>No data</div>;

  const W = 800, H = 160, PAD = 20;
  const vals  = data.map((d) => d.equity);
  const min   = Math.min(0, ...vals);
  const max   = Math.max(0, ...vals);
  const range = max - min || 1;

  const x = (i) => PAD + (i / (data.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - ((v - min) / range) * (H - 2 * PAD);

  const points = data.map((d, i) => `${x(i)},${y(d.equity)}`).join(' ');
  const zeroY  = y(0);
  const lastColor = vals[vals.length - 1] >= 0 ? '#22c55e' : '#ef4444';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#1e2a3a" strokeWidth="1" strokeDasharray="4,4" />
      <polyline points={points} fill="none" stroke={lastColor} strokeWidth="2" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.equity)} r={3} fill={d.equity >= 0 ? '#22c55e' : '#ef4444'} />
      ))}
    </svg>
  );
}
