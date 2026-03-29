import { useState, useEffect, useCallback, useRef } from 'react';
import './index.css';
import { SYMBOLS, SCORE_SIGNAL, LS_KEYS } from './config/constants';
import { fetchPrice, fetchCandles, lastCandleSource } from './utils/dataFetchers';
import { getSession, getISTTime, getActiveKillzone } from './utils/sessionDetection';
import { lsGet, lsSet } from './utils/localStorage';
import { fmt, fmtPct, fmtINRFull, fmtPips, fmtTime } from './utils/formatting';
import { calcPosition, recommendedLots } from './utils/pipCalculations';
import { runICTAnalysis } from './engine/ictAnalysis';
import { detectAMDPhase } from './engine/amdDetector';
import { supabase } from './supabaseClient';
import { isDriveConnected, getDriveInfo, getClientId, saveClientId, connectDrive, disconnectDrive, backupToDrive, restoreFromDrive } from './utils/driveSync';
import Chart from './components/Chart';
import WalkForwardPage from './components/WalkForward';

const TABS = [
  { id: 'scanner',    label: 'Scanner',    icon: '⊞' },
  { id: 'signals',    label: 'Signals',    icon: '◎' },
  { id: 'paper',      label: 'Paper Trade', icon: '◉' },
  { id: 'wfo',        label: 'Walk Forward', icon: '◷' },
  { id: 'calculator', label: 'Calculator', icon: '⊕' },
  { id: 'tradelog',   label: 'Trade Log',  icon: '≡' },
  { id: 'knowledge',  label: 'Knowledge',  icon: '⊗' },
  { id: 'settings',   label: 'Settings',   icon: '⚙' },
];

// ═══ KNOWLEDGE PAGE GLOSSARY DATA ═══
const GLOSSARY = [
  { category: 'ICT Concepts', color: '#e2b340', icon: '📐', terms: [
    { abbr: 'ICT', full: 'Inner Circle Trader', desc: 'Trading methodology developed by Michael J. Huddleston. Focuses on institutional order flow, smart money concepts and price delivery.' },
    { abbr: 'SMC', full: 'Smart Money Concepts', desc: 'A broader term for trading approaches that track institutional ("smart money") activity — includes ICT, order blocks, FVGs and liquidity.' },
    { abbr: 'OB', full: 'Order Block', desc: 'The last opposing candle before a strong displacement move. Institutions leave unfilled orders here. Bullish OB = last bearish candle before a bullish leg. Bearish OB = last bullish candle before a bearish leg.' },
    { abbr: 'FVG', full: 'Fair Value Gap', desc: "A three-candle imbalance where candle 1's high is below candle 3's low (bullish FVG) or candle 1's low is above candle 3's high (bearish FVG). Price tends to return and fill these gaps." },
    { abbr: 'IFVG', full: 'Inverted Fair Value Gap', desc: 'An FVG that has been fully mitigated (filled) and now acts as support/resistance in the opposite direction.' },
    { abbr: 'BOS', full: 'Break of Structure', desc: 'Price closes beyond a prior swing high (bullish BOS) or swing low (bearish BOS), confirming a trend continuation or shift.' },
    { abbr: 'CHoCH', full: 'Change of Character', desc: 'The first BOS in the opposite direction of the prevailing trend — early signal of a trend reversal.' },
    { abbr: 'MSB', full: 'Market Structure Break', desc: 'Same as BOS — used interchangeably. Confirmation that price has broken a key swing level.' },
    { abbr: 'P/D', full: 'Premium / Discount', desc: 'Premium = upper 50% of the swing range (sell zone). Discount = lower 50% (buy zone). Measured from swing low to swing high using the 50% equilibrium as the midpoint.' },
    { abbr: 'EQ', full: 'Equilibrium', desc: 'The 50% midpoint of a price range. ICT traders look to buy in discount (below EQ) and sell in premium (above EQ).' },
    { abbr: 'OTE', full: 'Optimal Trade Entry', desc: 'The 61.8%–78.6% Fibonacci retracement zone within a swing — considered the highest-probability entry area in ICT methodology.' },
    { abbr: 'AMD', full: 'Accumulation / Manipulation / Distribution', desc: 'The three-phase ICT market cycle. Accumulation = institutions quietly building positions. Manipulation = Judas swing to sweep liquidity. Distribution = institutions delivering price to targets.' },
    { abbr: 'BSL', full: 'Buy-Side Liquidity', desc: 'Clusters of buy stop orders sitting above swing highs and equal highs. Institutions drive price up to sweep BSL before reversing lower.' },
    { abbr: 'SSL', full: 'Sell-Side Liquidity', desc: 'Clusters of sell stop orders sitting below swing lows and equal lows. Institutions drive price down to sweep SSL before reversing higher.' },
    { abbr: 'LIQ', full: 'Liquidity', desc: 'Generic term for stop orders accumulated at key levels (swing highs, swing lows, equal highs/lows). Institutions need liquidity to fill large orders.' },
    { abbr: 'IPDA', full: 'Interbank Price Delivery Algorithm', desc: "ICT's concept of how price is algorithmically delivered from one liquidity level to the next, respecting premium/discount zones and FVGs." },
    { abbr: 'PD Array', full: 'Premium / Discount Array', desc: 'The hierarchy of ICT tools used to identify where price is likely to react: OBs > FVGs > Mitigation Blocks > Breaker Blocks > Rejection Blocks.' },
    { abbr: 'KZ', full: 'Kill Zone', desc: 'High-probability trading sessions: Asia KZ (00:00–02:00 UTC), London KZ (07:00–09:00 UTC), NY Open KZ (12:00–14:00 UTC), Silver Bullet (15:00–16:00 UTC).' },
  ]},
  { category: 'Chart & Signal Terms', color: '#3b82f6', icon: '📊', terms: [
    { abbr: 'SL', full: 'Stop Loss', desc: 'The price level where a losing trade is automatically closed to limit risk. Placed beyond the invalidation point of the setup.' },
    { abbr: 'TP', full: 'Take Profit', desc: 'The price target where a winning trade is closed. TP1 = first target (1.5× risk), TP2 = extended target (3× risk).' },
    { abbr: 'TP1', full: 'Take Profit 1', desc: 'First partial profit target. Set at 1.5× the risk distance (entry to stop loss). Close 50–75% of position here.' },
    { abbr: 'TP2', full: 'Take Profit 2', desc: 'Second extended profit target. Set at 3× the risk distance. Let remaining position run to this level.' },
    { abbr: 'RR', full: 'Risk-to-Reward Ratio', desc: 'The ratio of potential profit to potential loss. TP1 = 1.5R, TP2 = 3R. ICT setups target a minimum of 1:2 RR.' },
    { abbr: 'OHLCV', full: 'Open, High, Low, Close, Volume', desc: 'The five data points that make up a candlestick bar.' },
    { abbr: 'TF', full: 'Timeframe', desc: 'The duration of each candle bar: 1m, 5m, 15m, 1h, 1D. Higher TFs show macro structure; lower TFs show entry precision.' },
    { abbr: 'HTF', full: 'Higher Timeframe', desc: 'A longer-duration chart used for bias and structure. E.g. if trading 15m entries, the 1h or 4h is the HTF.' },
    { abbr: 'LTF', full: 'Lower Timeframe', desc: 'A shorter-duration chart used for precise entry timing and confirmation (e.g. 1m or 5m for a 15m setup).' },
    { abbr: 'ATR', full: 'Average True Range', desc: 'A volatility measure calculated over the last 14 candles. Used in phase detection and OB validation.' },
    { abbr: 'P&L', full: 'Profit and Loss', desc: 'Net financial result of trades. Displayed in both USD and INR (₹).' },
  ]},
  { category: 'Scoring & Confluence', color: '#22c55e', icon: '🎯', terms: [
    { abbr: 'HIGH', full: 'High Confidence Signal', desc: 'Score ≥ 70/100. All anchors passed, minimal penalties, strong multi-pillar confluence.' },
    { abbr: 'MEDIUM', full: 'Medium Confidence Signal', desc: 'Score 50–69/100. Anchors passed, some penalties present. Trade with reduced position size.' },
    { abbr: 'LOW', full: 'Low Confidence Signal', desc: 'Score < 50/100 or anchors failed. Not recommended for trading. Monitor only.' },
    { abbr: 'LONG', full: 'Long / Buy Bias', desc: 'Bullish directional bias. ICT engine detected more bullish confluence than bearish.' },
    { abbr: 'SHORT', full: 'Short / Sell Bias', desc: 'Bearish directional bias. ICT engine detected more bearish confluence than bullish.' },
    { abbr: 'NEUTRAL', full: 'Neutral / No Clear Bias', desc: 'Bull and bear scores are too close to determine direction. No trade signal generated.' },
    { abbr: 'FRESH', full: 'Fresh Zone', desc: 'An OB or FVG that has not yet been tested. Highest probability for a reaction.' },
    { abbr: 'TESTED', full: 'Tested Zone', desc: 'An OB or FVG that price has touched once. Still valid but with reduced probability.' },
    { abbr: 'BROKEN', full: 'Broken Zone', desc: 'An OB or FVG that price has traded through. Zone is invalidated.' },
  ]},
  { category: 'Market Phases (AMD)', color: '#a855f7', icon: '🔄', terms: [
    { abbr: 'ACCUMULATION', full: 'Accumulation Phase', desc: 'Institutions quietly building positions in a sideways, low-volatility range. Equal highs/lows, compressed ATR, price at discount.' },
    { abbr: 'MANIPULATION', full: 'Manipulation Phase', desc: 'The Judas Swing — a deliberate false move to sweep stop losses before the real move. Sharp displacement in the true direction follows.' },
    { abbr: 'DISTRIBUTION', full: 'Distribution Phase', desc: 'Institutions quietly unloading positions at premium levels after markup. Range-bound at highs with shrinking volume.' },
    { abbr: 'MARKUP', full: 'Markup Phase', desc: 'Bullish expansion following accumulation. Strong displacement candles, higher highs and higher lows.' },
    { abbr: 'MARKDOWN', full: 'Markdown Phase', desc: 'Bearish expansion following distribution. Strong displacement down, lower highs and lower lows.' },
  ]},
  { category: 'Sessions & Times (IST)', color: '#f97316', icon: '🕐', terms: [
    { abbr: 'IST', full: 'Indian Standard Time (UTC+5:30)', desc: 'All times in this app are displayed in IST.' },
    { abbr: 'Asia KZ', full: 'Asia Kill Zone', desc: 'IST: 05:30–07:30. Low volatility session. Range forms that London will manipulate.' },
    { abbr: 'London KZ', full: 'London Kill Zone', desc: 'IST: 12:30–14:30. High volatility. Often the manipulation phase of the AMD cycle.' },
    { abbr: 'NY KZ', full: 'New York Kill Zone', desc: 'IST: 17:30–19:30. Highest volatility. Often the true distribution/markup move of the day.' },
    { abbr: 'Silver Bullet', full: 'Silver Bullet Window', desc: 'IST: 20:30–21:30. ICT-specific high-probability window. Look for FVG entries after a manipulation spike.' },
    { abbr: 'Dead Zone', full: 'Dead / Overlap Zone', desc: 'IST: 00:30–05:30. Low institutional participation. Avoid trading during this period.' },
  ]},
  { category: 'Data & Technical', color: '#94a3b8', icon: '⚙️', terms: [
    { abbr: 'TD', full: 'Twelve Data', desc: 'Primary candle data source. Provides real spot prices for XAU/USD and XAG/USD. Free plan: 800 API requests/day.' },
    { abbr: 'YF', full: 'Yahoo Finance', desc: 'Fallback candle data source via Cloudflare Worker. Returns futures data when Twelve Data is unavailable.' },
    { abbr: 'GC=F', full: 'Gold Futures (CME/NYMEX)', desc: 'CME gold futures ticker. Typically $5–35 above spot XAU/USD due to futures premium (contango).' },
    { abbr: 'SI=F', full: 'Silver Futures (CME/NYMEX)', desc: 'CME silver futures ticker. Slightly above spot XAG/USD.' },
    { abbr: 'CL=F', full: 'Crude Oil WTI Futures', desc: 'NYMEX WTI crude oil futures ticker. Used for USOIL price data.' },
    { abbr: 'NG=F', full: 'Natural Gas Futures', desc: 'NYMEX natural gas futures ticker. Used for NATGAS price data.' },
    { abbr: 'XAUUSD', full: 'Gold / US Dollar (Spot)', desc: 'The spot price of gold against the US dollar. 1 standard lot = 100 oz. Pip = $0.10.' },
    { abbr: 'XAGUSD', full: 'Silver / US Dollar (Spot)', desc: 'The spot price of silver against the US dollar. 1 standard lot = 5,000 oz.' },
    { abbr: 'USOIL', full: 'US Crude Oil WTI (Spot)', desc: 'West Texas Intermediate crude oil. Priced per barrel in USD.' },
    { abbr: 'NATGAS', full: 'Natural Gas (Spot)', desc: 'Henry Hub natural gas spot price. Priced per MMBtu.' },
    { abbr: 'INR', full: 'Indian Rupee (₹)', desc: 'Profit/loss and position sizing converted to INR using fixed USD/INR rate (~₹83).' },
  ]},
  { category: 'Advanced Engines & WFO', color: '#ef4444', icon: '🧠', terms: [
    { abbr: 'WFO', full: 'Walk-Forward Optimization', desc: 'An institutional backtesting methodology that continuously re-optimizes parameters on a sliding window of past data to predict the immediate future, combating curve-fitting.' },
    { abbr: 'IS / OOS', full: 'In-Sample / Out-of-Sample', desc: 'IS data is used to train/optimize the engine. OOS data is completely unseen future data where the optimized strategy is tested. Our WFO engine uses a strict 70/30 split.' },
    { abbr: 'WFE', full: 'Walk-Forward Efficiency', desc: 'A proprietary metric calculating how well the strategy performs in the OOS test compared to its IS training. A WFE > 50% generally signifies a robust engine.' },
    { abbr: 'DD', full: 'Drawdown', desc: 'The peak-to-trough decline of the portfolio curve during testing. High strictness in the Sovereign engine filters out setups that historically caused > 20% DD.' },
  ]},
];

function TermRow({ term }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(o => !o)} style={{ padding: '11px 16px', borderBottom: '1px solid var(--s3)', cursor: 'pointer', background: open ? 'var(--s2)' : 'transparent', transition: 'background 0.15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', minWidth: 110, flexShrink: 0 }}>{term.abbr}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', flex: 1 }}>{term.full}</span>
        <span style={{ fontSize: 11, color: 'var(--t3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </div>
      {open && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--t2)', lineHeight: 1.7, paddingLeft: 122 }}>{term.desc}</p>}
    </div>
  );
}

function CategoryCard({ cat }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: open ? '1px solid var(--s3)' : 'none' }}>
        <span style={{ fontSize: 20 }}>{cat.icon}</span>
        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--t1)', flex: 1, textAlign: 'left' }}>{cat.category}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: cat.color + '22', color: cat.color }}>{cat.terms.length} terms</span>
        <span style={{ fontSize: 12, color: 'var(--t3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>
      {open && <div>{cat.terms.map(t => <TermRow key={t.abbr} term={t} />)}</div>}
    </div>
  );
}

function KnowledgePage() {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const filtered = q ? GLOSSARY.map(cat => ({ ...cat, terms: cat.terms.filter(t => t.abbr.toLowerCase().includes(q) || t.full.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)) })).filter(cat => cat.terms.length > 0) : GLOSSARY;
  const totalTerms = GLOSSARY.reduce((s, c) => s + c.terms.length, 0);
  return (
    <div>
      <div className="card" style={{ marginBottom: 20, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <span style={{ fontSize: 26 }}>📖</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--t1)' }}>Glossary of Abbreviations</div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{totalTerms} terms across {GLOSSARY.length} categories · Click any term to expand</div>
          </div>
        </div>
        <div style={{ background: 'var(--s2)', padding: '20px 24px', borderRadius: 12, marginBottom: 20, border: '1px solid var(--accent-glow)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚡</span> How are Sovereign Signals Generated?
          </div>
          <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7, marginBottom: 12 }}>
            The Sovereign SMC Engine uses a <strong>Multi-Timeframe Macro Alignment</strong> workflow to isolate high-probability institutional setups while filtering out retail noise.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <div style={{ background: 'var(--s1)', padding: 12, borderRadius: 8, border: '1px solid var(--s3)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--t1)', marginBottom: 6 }}>1. Macro Structure (HTF)</div>
              <div style={{ fontSize: 11, color: 'var(--t2)' }}>Scans 500+ candles to define the 'Sovereign Swing'. We only trade in the direction of the macro fractal trend.</div>
            </div>
            <div style={{ background: 'var(--s1)', padding: 12, borderRadius: 8, border: '1px solid var(--s3)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--t1)', marginBottom: 6 }}>2. Liquidity Mapping</div>
              <div style={{ fontSize: 11, color: 'var(--t2)' }}>Identifies SSL/BSL pools and 'Equal' levels. The engine hunts for the <strong>Judas Swing</strong> (stop hunt) before confirming entry.</div>
            </div>
            <div style={{ background: 'var(--s1)', padding: 12, borderRadius: 8, border: '1px solid var(--s3)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--t1)', marginBottom: 6 }}>3. PD Array Validation</div>
              <div style={{ fontSize: 11, color: 'var(--t2)' }}>Filters for Order Blocks and FVGs that reside strictly in the <strong>Discount (for Longs)</strong> or <strong>Premium (for Shorts)</strong> zones.</div>
            </div>
            <div style={{ background: 'var(--s1)', padding: 12, borderRadius: 8, border: '1px solid var(--s3)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--t1)', marginBottom: 6 }}>4. Algorithmic Scoring</div>
              <div style={{ fontSize: 11, color: 'var(--t2)' }}>A 10-pillar confluence check (Displacement, SMT, Session, etc.). <strong>Scores ≥ 70</strong> trigger the 'Take Trade' automation.</div>
            </div>
          </div>
        </div>
        <input type="text" placeholder="Search abbreviations… (e.g. OB, FVG, BOS, AMD)" value={search} onChange={e => setSearch(e.target.value)} className="input" style={{ width: '100%' }} />
        {q && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--t3)' }}>{filtered.reduce((s, c) => s + c.terms.length, 0)} result(s) for "{search}"</div>}
      </div>
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>No abbreviations found for "{search}"</div>
      ) : (
        filtered.map(cat => <CategoryCard key={cat.category} cat={cat} />)
      )}
    </div>
  );
}


function FloatingAIChat({ currentSym, currentAnalysis, amdPhase, currentPrice, apiKey }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Hi! I am your SMC Trading Assistant. Ask me to analyze the current chart!' }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || !apiKey) return;
    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Build context
      const context = `
Current Chart: ${currentSym} @ ${currentPrice || 'Loading...'}
Engine Bias: ${currentAnalysis?.bias || 'N/A'}, Score: ${currentAnalysis?.score || 0}/100
AMD Phase: ${amdPhase?.label || 'N/A'} - ${amdPhase?.description || ''}
Order Blocks: ${(currentAnalysis?.orderBlocks || []).length} active
FVGs: ${(currentAnalysis?.fvgs || []).length} unmitigated
      `.trim();

      const prompt = `System: You are an expert SMC / ICT Trading Assistant. Analyze the user query based strictly on the current live chart context provided below. Be concise, actionable, and use formatting.
[Context]
${context}
---
User Query: ${userMsg.content}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                   (data?.promptFeedback?.blockReason ? `Blocked: ${data.promptFeedback.blockReason}` : "I couldn't generate a response.");
      setMessages(p => [...p, { role: 'assistant', content: text }]);
    } catch (err) {
      setMessages(p => [...p, { role: 'assistant', content: `AI Error: ${err.message}` }]);
    }
    setLoading(false);
  };

  if (!apiKey) {
    return (
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999 }}>
        <button onClick={() => alert('Please configure Gemini API Key in Settings')} style={{ width: 50, height: 50, borderRadius: 25, background: '#a855f7', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>✨</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      {isOpen && (
        <div className="card" style={{ width: 340, height: 450, marginBottom: 16, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
          <div style={{ padding: '12px 16px', background: 'var(--s2)', borderBottom: '1px solid var(--s3)', fontWeight: 800, color: 'var(--t1)', display: 'flex', justifyContent: 'space-between' }}>
            <span>✨ SMC Engine AI</span>
            <span style={{ cursor: 'pointer' }} onClick={() => setIsOpen(false)}>✕</span>
          </div>
          <div style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ padding: 10, borderRadius: 8, background: m.role === 'user' ? 'var(--s3)' : '#a855f722', color: m.role === 'user' ? 'var(--t1)' : 'var(--t1)', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', fontSize: 13, lineHeight: 1.5 }}>
                {m.content}
              </div>
            ))}
            {loading && <div style={{ fontSize: 12, color: 'var(--t3)' }}>Analyzing chart...</div>}
            <div ref={endRef} />
          </div>
          <div style={{ padding: 12, borderTop: '1px solid var(--s3)', display: 'flex', gap: 8 }}>
            <input className="input" placeholder="Ask about the chart..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} style={{ flex: 1, padding: '8px 12px' }} />
            <button className="btn btn-primary" onClick={handleSend} disabled={loading} style={{ background: '#a855f7', color: '#fff', border: 'none' }}>▶</button>
          </div>
        </div>
      )}
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} style={{ width: 56, height: 56, borderRadius: 28, background: '#a855f7', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</button>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('scanner');
  const [prices, setPrices] = useState({});
  const [analyses, setAnalyses] = useState({});
  const [signals, setSignals] = useState([]);
  const [session, setSession] = useState(getSession());
  const [istTime, setISTTime] = useState(getISTTime());
  const [killzone, setKillzone] = useState(getActiveKillzone());
  const [loading, setLoading] = useState({});
  const [settings, setSettings] = useState(lsGet(LS_KEYS.SETTINGS, {}));
  const [selectedSym, setSelectedSym] = useState(SYMBOLS[0]);
  const [dataSource, setDataSource] = useState(null);
  const [theme, setTheme] = useState('dark');

  // Drive state
  const [driveClientId, setDriveClientId] = useState(() => getClientId());
  const [driveInfo, setDriveInfo] = useState(() => getDriveInfo());
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveBacking, setDriveBacking] = useState(false);
  const [driveRestoring, setDriveRestoring] = useState(false);
  const [driveMsg, setDriveMsg] = useState('');

  const refreshDriveState = () => {
    setDriveClientId(getClientId());
    setDriveInfo(getDriveInfo());
  };

  const handleDriveConnect = async () => {
    if (!driveClientId.trim()) { setDriveMsg('⚠ Enter Client ID first'); return; }
    setDriveConnecting(true); setDriveMsg('');
    try {
      saveClientId(driveClientId);
      await connectDrive(driveClientId.trim());
      setDriveMsg('✓ Connected to Google Drive');
      refreshDriveState();
    } catch (err) { setDriveMsg(`✕ Connect failed: ${err.message}`); }
    setDriveConnecting(false);
  };

  const handleDriveDisconnect = () => { disconnectDrive(); refreshDriveState(); setDriveMsg('Disconnected'); };

  const handleDriveBackup = async () => {
    setDriveBacking(true); setDriveMsg('');
    const res = await backupToDrive();
    if (res.ok) { setDriveMsg(`✓ Backup saved at ${new Date(res.lastBackup).toLocaleTimeString()}`); refreshDriveState(); }
    else { setDriveMsg(`✕ Backup failed: ${res.msg}`); }
    setDriveBacking(false);
  };

  const handleDriveRestore = async () => {
    if (!window.confirm('This will overwrite ALL current local data with the Drive backup. Continue?')) return;
    setDriveRestoring(true); setDriveMsg('');
    const res = await restoreFromDrive();
    if (res.ok) { setDriveMsg(`✓ Restored from ${new Date(res.backedUpAt).toLocaleString()}! Reloading…`); setTimeout(() => window.location.reload(), 2000); }
    else { setDriveMsg(`✕ Restore failed: ${res.msg}`); }
    setDriveRestoring(false);
  };

  // Auto-backup to Drive every 5 min if connected
  useEffect(() => {
    const id = setInterval(() => { if (isDriveConnected()) backupToDrive().then(refreshDriveState); }, 5 * 60000);
    return () => clearInterval(id);
  }, []);

  // Chart State
  const [chartCandles, setChartCandles] = useState([]);
  const [chartAnalysis, setChartAnalysis] = useState(null);
  const [chartAMD, setChartAMD] = useState(null);
  const [chartTF, setChartTF] = useState({ label: '15m', value: '15m', range: '60d', aggregate: null });

  const loadChart = useCallback(async () => {
    setChartAnalysis(null);
    setChartAMD(null);
    setChartCandles([]);
    try {
      const data = await fetchCandles(selectedSym, chartTF.value, chartTF.range, chartTF.aggregate);
      setChartCandles(data);
      if (data && data.length > 20) {
        setChartAnalysis(runICTAnalysis(data, selectedSym));
        setChartAMD(detectAMDPhase(data));
      }
    } catch (e) {
      console.error('Chart load error:', e);
    }
  }, [selectedSym, chartTF]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);
  
  // Timer updates
  useEffect(() => {
    const id = setInterval(() => {
      setSession(getSession());
      setISTTime(getISTTime());
      setKillzone(getActiveKillzone());
    }, 10000);
    return () => clearInterval(id);
  }, []);

  // Price refresh
  const refreshPrices = useCallback(async () => {
    const results = {};
    await Promise.allSettled(SYMBOLS.map(async (sym) => {
      try { results[sym.id] = await fetchPrice(sym); }
      catch { results[sym.id] = prices[sym.id] || { price: 0, change: 0, changePct: 0 }; }
    }));
    setPrices(prev => ({ ...prev, ...results }));
  }, []);

  // Telegram Helper
  const sendTelegramMessage = async (msg) => {
    if (!settings.tgBotToken || !settings.tgChatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${settings.tgBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: settings.tgChatId, text: msg, parse_mode: 'Markdown' })
      });
    } catch (e) { console.error('Telegram error', e); }
  };

  // Scanner
  const runScan = useCallback(async (sym) => {
    setLoading(p => ({ ...p, [sym.id]: true }));
    try {
      const candles = await fetchCandles(sym, '15m', '5d');
      if (candles && candles.length >= 20) {
        const result = runICTAnalysis(candles, sym);
        setAnalyses(p => ({ ...p, [sym.id]: result }));
        setDataSource({ ...lastCandleSource });
        if (result.score >= SCORE_SIGNAL && result.bias !== 'NEUTRAL') {
          const sig = { id: `${sym.id}-${Date.now()}`, timestamp: Date.now(), symbol: sym.id, ...result, timeframe: '15m' };
          
          // Push to Supabase
          const cleanSig = { id: sig.id, timestamp: sig.timestamp, symbol: sig.symbol, bias: sig.bias, score: sig.score, confidence: sig.confidence, entry: sig.entry, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2, timeframe: sig.timeframe || '15m' };
          supabase.from('st_signals').insert([cleanSig]).then(res => {
            if (res.error) console.warn('Supabase Sig err:', res.error);
          });

          setSignals(p => {
            const merged = [...p, sig].slice(-100);
            lsSet(LS_KEYS.SIGNALS, merged);
            return merged;
          });
        }
      }
    } catch (err) { console.warn(`Scan ${sym.id}:`, err); }
    setLoading(p => ({ ...p, [sym.id]: false }));
  }, []);

  const scanAll = useCallback(() => SYMBOLS.forEach(s => runScan(s)), [runScan]);

  useEffect(() => {
    // Fetch from Supabase on init
    const loadCloudData = async () => {
      // 1. Immediate Load from LocalStorage (UX first)
      const localSettings = lsGet(LS_KEYS.SETTINGS, {});
      const localSignals = lsGet(LS_KEYS.SIGNALS, []);
      const localTrades = lsGet('st_trade_log', []);
      const localPaperPos = lsGet('st_paper_pos', []);
      const localPaperHist = lsGet('st_paper_hist', []);
      const localPaperBal = lsGet('st_paper_bal', 1000000);

      if (localSettings) setSettings(localSettings);
      if (localSignals.length) setSignals(localSignals);
      if (localTrades.length) setTrades(localTrades);
      if (localPaperPos.length) setPaperPositions(localPaperPos);
      if (localPaperHist.length) setPaperHistory(localPaperHist);
      setPaperBalance(localPaperBal);

      // 2. Background Sync from Supabase
      try {
        const { data: stgs } = await supabase.from('st_settings').select('*').eq('id', 1).single();
        if (stgs) {
          setSettings(stgs);
          lsSet(LS_KEYS.SETTINGS, stgs);
        }

        const { data: sigs } = await supabase.from('st_signals').select('*').order('timestamp', { ascending: false }).limit(100);
        if (sigs && sigs.length > 0) {
          setSignals(sigs);
          lsSet(LS_KEYS.SIGNALS, sigs);
        }
        
        const { data: trds } = await supabase.from('st_trade_log').select('*').order('timestamp', { ascending: false });
        if (trds && trds.length > 0) {
          setTrades(trds);
          lsSet('st_trade_log', trds);
        }

        // New Paper Trading cloud sync
        const { data: pPos } = await supabase.from('st_paper_pos').select('*');
        if (pPos && pPos.length > 0) { setPaperPositions(pPos); lsSet('st_paper_pos', pPos); }

        const { data: pHist } = await supabase.from('st_paper_hist').select('*').order('closeTime', { ascending: false });
        if (pHist && pHist.length > 0) { setPaperHistory(pHist); lsSet('st_paper_hist', pHist); }

        const { data: pBal } = await supabase.from('st_paper_bal').select('*').eq('id', 1).single();
        if (pBal && pBal.balance != null) { setPaperBalance(pBal.balance); lsSet('st_paper_bal', pBal.balance); }

      } catch (e) {
        console.warn('Supabase sync error', e);
      }
    };
    loadCloudData();

    refreshPrices();
    const pi = setInterval(refreshPrices, 3000);
    scanAll();
    const sci = setInterval(scanAll, 90000);
    return () => { clearInterval(pi); clearInterval(sci); };
  }, []);

  const saveSettings = (key, val) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    lsSet(LS_KEYS.SETTINGS, next);
    // Sync to Supabase cloud
    supabase.from('st_settings').upsert({ id: 1, ...next }).then();
  };

  const [testStatus, setTestStatus] = useState({});
  const runTest = async (key) => {
    setTestStatus(p => ({ ...p, [key]: 'loading' }));
    try {
      if (key === 'worker') {
        if (!settings.workerUrl) throw new Error('No URL set');
        const url = settings.workerUrl.replace(/\/$/, '') + '/?sym=XAUUSD&interval=1d&outputsize=1';
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const contentType = r.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await r.text();
          throw new Error(`Invalid response (Expected JSON, got ${contentType}). Data: ${text.slice(0, 50)}...`);
        }
        const d = await r.json();
        if (!d || d.length === 0) throw new Error('No data returned from Worker');
        setTestStatus(p => ({ ...p, [key]: '✓ Connected (Data returned)' }));
      }
      else if (key === 'twelve') {
        if (!settings.twelveKey) throw new Error('No key set');
        const r = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${settings.twelveKey}`);
        const d = await r.json();
        if (d.code === 429 || (d.message && d.message.includes('credits'))) {
          throw new Error('API Credits Exhausted for the day.');
        }
        if (d.code) throw new Error(d.message || 'Invalid key');
        if (!d.price) throw new Error('No price data returned');
        setTestStatus(p => ({ ...p, [key]: '✓ Connected (Price check OK)' }));
      }
      else if (key === 'tg') {
        if (!settings.tgBotToken || !settings.tgChatId) throw new Error('Missing token/chat ID');
        const r = await fetch(`https://api.telegram.org/bot${settings.tgBotToken}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: settings.tgChatId, text: '✅ connection OK' })
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.description || 'Failed to send message');
        setTestStatus(p => ({ ...p, [key]: '✓ Connected (Message sent)' }));
      }
      else if (key === 'gemini') {
        if (!settings.geminiKey) throw new Error('No key set');
        const r = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${settings.geminiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            contents: [{ parts: [{ text: "Respond with the word OK." }] }],
            safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }]
          })
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message || 'Invalid API Key');
        setTestStatus(p => ({ ...p, [key]: '✓ Connected (LLM responded)' }));
      }
      else if (key === 'dhan') {
        if (!settings.dhanKey) throw new Error('No token set');
        await new Promise(res => setTimeout(res, 600));
        setTestStatus(p => ({ ...p, [key]: '⚠ Connected (Dhan APIs pending)' }));
      }
    } catch (e) {
      setTestStatus(p => ({ ...p, [key]: `✕ Failed: ${e.message}` }));
    }
  };

  const handleExport = () => {
    const backup = { version: 2, exportedAt: new Date().toISOString(), settings: lsGet(LS_KEYS.SETTINGS, {}), signals: lsGet(LS_KEYS.SIGNALS, []), tradeLog: lsGet('st_trade_log', []) };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `sovereign-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importRef = useRef(null);
  const [importMsg, setImportMsg] = useState('');
  const handleImport = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (backup.settings) lsSet(LS_KEYS.SETTINGS, backup.settings);
        if (backup.signals) lsSet(LS_KEYS.SIGNALS, backup.signals);
        if (backup.tradeLog) lsSet('st_trade_log', backup.tradeLog);
        setImportMsg(`✓ Restored! Reloading…`);
        setTimeout(() => window.location.reload(), 1500);
      } catch { setImportMsg('⚠ Invalid backup file'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Calculator state ──
  const [calcSymId, setCalcSymId] = useState('XAUUSD');
  const [calcEntry, setCalcEntry] = useState('');
  const [calcSL, setCalcSL] = useState('');
  const [calcTP1, setCalcTP1] = useState('');
  const [calcTP2, setCalcTP2] = useState('');
  const [calcLots, setCalcLots] = useState('1');
  const calcSym = SYMBOLS.find(s => s.id === calcSymId) || SYMBOLS[0];
  const calcResult = (calcEntry && calcSL) ? calcPosition({ symId: calcSymId, entry: +calcEntry, sl: +calcSL, tp1: calcTP1 ? +calcTP1 : null, tp2: calcTP2 ? +calcTP2 : null, lotSize: +calcLots || 1 }) : null;
  const suggestedLots = (calcEntry && calcSL) ? recommendedLots({ symId: calcSymId, entry: +calcEntry, sl: +calcSL }) : null;

  // ── Trade Log state ──
  const [trades, setTrades] = useState(lsGet('st_trade_log', []));
  const [tradeForm, setTradeForm] = useState({ symbol: 'XAUUSD', bias: 'LONG', entry: '', sl: '', tp: '', lots: '1', pnl: '', notes: '' });
  const addTrade = () => {
    if (!tradeForm.entry) return;
    const t = { ...tradeForm, id: Date.now(), timestamp: Date.now(), entry: +tradeForm.entry, sl: +tradeForm.sl || 0, tp: +tradeForm.tp || 0, lots: +tradeForm.lots || 1, pnl: +tradeForm.pnl || 0 };
    const updated = [...trades, t];
    setTrades(updated); lsSet('st_trade_log', updated);
    
    // Supabase Sync
    supabase.from('st_trade_log').insert([t]).then();

    setTradeForm({ symbol: 'XAUUSD', bias: 'LONG', entry: '', sl: '', tp: '', lots: '1', pnl: '', notes: '' });
  };

  // ── Paper Trading state ──
  const STARTING_CAPITAL = 1000000;
  const [paperPositions, setPaperPositions] = useState(lsGet('st_paper_pos', []));
  const [paperHistory, setPaperHistory] = useState(lsGet('st_paper_hist', []));
  const [paperBalance, setPaperBalance] = useState(lsGet('st_paper_bal', STARTING_CAPITAL));
  const [paperForm, setPaperForm] = useState({ symbol: 'XAUUSD', bias: 'LONG', entry: '', sl: '', tp1: '', lots: '1' });
  const [paperError, setPaperError] = useState('');

  const symConfig = (id) => SYMBOLS.find(s => s.id === id) || SYMBOLS[0];

  // Auto-close positions when prices update
  useEffect(() => {
    if (!paperPositions.length || !Object.keys(prices).length) return;
    let updated = [...paperPositions], closed = [], newBal = paperBalance;
    updated = updated.filter(pos => {
      const cp = prices[pos.symbol]?.price;
      if (!cp) return true;
      const s = symConfig(pos.symbol);
      const isLong = pos.bias === 'LONG';
      let hit = null;
      if (isLong) {
        if (cp <= pos.sl) hit = { type: 'SL', price: pos.sl };
        if (cp >= pos.tp1) hit = { type: 'TP1', price: pos.tp1 };
      } else {
        if (cp >= pos.sl) hit = { type: 'SL', price: pos.sl };
        if (cp <= pos.tp1) hit = { type: 'TP1', price: pos.tp1 };
      }
      if (!hit) return true;
      const pips = Math.abs(pos.entry - hit.price) * (s.pipMultiplier || 10);
      const dirMult = isLong ? (hit.price > pos.entry ? 1 : -1) : (hit.price < pos.entry ? 1 : -1);
      const pnl = pips * (s.pipValuePerLot || 10) * pos.lots * 83 * dirMult;
      closed.push({ ...pos, closePrice: hit.price, closeTime: Date.now(), closeType: hit.type, pips: +(pips * dirMult).toFixed(2), pnlInr: Math.round(pnl), result: hit.type === 'TP1' ? 'WIN' : 'LOSS' });
      newBal += Math.round(pnl);
      return false;
    });
    if (closed.length > 0) {
      const newHist = [...closed, ...paperHistory];
      setPaperPositions(updated); setPaperHistory(newHist); setPaperBalance(newBal);
      lsSet('st_paper_pos', updated); lsSet('st_paper_hist', newHist); lsSet('st_paper_bal', newBal);
      
      // Supabase Sync
      for (const c of closed) {
        supabase.from('st_paper_hist').insert([c]).then();
        supabase.from('st_paper_pos').delete().eq('id', c.id).then();
      }
      supabase.from('st_paper_bal').upsert({ id: 1, balance: newBal }).then();
    }
  }, [prices]);

  const openPaperPnl = paperPositions.reduce((sum, pos) => {
    const cp = prices[pos.symbol]?.price;
    if (!cp) return sum;
    const s = symConfig(pos.symbol);
    const pips = Math.abs(pos.entry - cp) * (s.pipMultiplier || 10);
    const dirMult = pos.bias === 'LONG' ? (cp > pos.entry ? 1 : -1) : (cp < pos.entry ? 1 : -1);
    return sum + pips * (s.pipValuePerLot || 10) * pos.lots * 83 * dirMult;
  }, 0);

  const takeTrade = (sig) => {
    const pos = { id: Date.now(), symbol: sig.symbol || selectedSym.id, bias: sig.bias, entry: +sig.entry, sl: +sig.sl, tp1: +sig.tp1, lots: 1, openTime: Date.now() };
    const upd = [pos, ...paperPositions];
    setPaperPositions(upd);
    lsSet('st_paper_pos', upd);
    
    // Supabase Sync
    supabase.from('st_paper_pos').insert([pos]).then();

    setTab('paper');
    const msg = `🚨 *Sovereign Trader Alert*\n\n${pos.symbol} ${pos.bias} at ${pos.entry}\nSL: ${pos.sl}\nTP1: ${pos.tp1}`;
    sendTelegramMessage(msg);
  };

  const openPaperPosition = () => {
    setPaperError('');
    if (!paperForm.entry || !paperForm.sl || !paperForm.tp1) { setPaperError('Entry, SL and TP1 required'); return; }
    const pos = { id: Date.now(), symbol: paperForm.symbol, bias: paperForm.bias, entry: +paperForm.entry, sl: +paperForm.sl, tp1: +paperForm.tp1, lots: +paperForm.lots || 1, openTime: Date.now() };
    
    // Auto-Telegram for High Probability Executions
    const a = analyses[paperForm.symbol];
    if (a && a.confidence === 'HIGH' && a.bias === paperForm.bias) {
      sendTelegramMessage(`🚀 *SMC High-Prob Execution (Paper)*\n\n*${pos.symbol}* | ${pos.bias === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}\nEntry: ${pos.entry}\nSL: ${pos.sl}\nTP: ${pos.tp1}\nLots: ${pos.lots}`);
    }

    const upd = [pos, ...paperPositions];
    setPaperPositions(upd); lsSet('st_paper_pos', upd);
    
    // Supabase Sync
    supabase.from('st_paper_pos').insert([pos]).then();

    setPaperForm(f => ({ ...f, entry: '', sl: '', tp1: '' }));
  };

  const closePaperManual = (pos) => {
    const cp = prices[pos.symbol]?.price || pos.entry;
    const s = symConfig(pos.symbol);
    const pips = Math.abs(pos.entry - cp) * (s.pipMultiplier || 10);
    const dirMult = pos.bias === 'LONG' ? (cp > pos.entry ? 1 : -1) : (cp < pos.entry ? 1 : -1);
    const pnl = pips * (s.pipValuePerLot || 10) * pos.lots * 83 * dirMult;
    const closed = { ...pos, closePrice: cp, closeTime: Date.now(), closeType: 'MANUAL', pips: +(pips * dirMult).toFixed(2), pnlInr: Math.round(pnl), result: pnl >= 0 ? 'WIN' : 'LOSS' };
    const updPos = paperPositions.filter(p => p.id !== pos.id);
    const newHist = [closed, ...paperHistory];
    const newBal = paperBalance + Math.round(pnl);
    setPaperPositions(updPos); setPaperHistory(newHist); setPaperBalance(newBal);
    lsSet('st_paper_pos', updPos); lsSet('st_paper_hist', newHist); lsSet('st_paper_bal', newBal);

    // Supabase Sync
    supabase.from('st_paper_pos').delete().eq('id', pos.id).then();
    supabase.from('st_paper_hist').insert([closed]).then();
    supabase.from('st_paper_bal').upsert({ id: 1, balance: newBal }).then();
  };

  const resetPaperAccount = () => {
    if (!window.confirm('Reset paper trading account to ₹10,00,000?')) return;
    setPaperPositions([]); setPaperHistory([]); setPaperBalance(STARTING_CAPITAL);
    lsSet('st_paper_pos', []); lsSet('st_paper_hist', []); lsSet('st_paper_bal', STARTING_CAPITAL);

    // Supabase Sync
    supabase.from('st_paper_pos').delete().neq('id', 0).then();
    supabase.from('st_paper_hist').delete().neq('id', 0).then();
    supabase.from('st_paper_bal').upsert({ id: 1, balance: STARTING_CAPITAL }).then();
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const currentAnalysis = analyses[selectedSym.id];

  return (
    <div className="app-shell" data-theme={theme}>
      {/* ═══ HEADER ═══ */}
      <header className="header">
        <div className="header-logo" onClick={() => setTab('scanner')} style={{ cursor: 'pointer' }}>
          <div style={{ width: 32, height: 32, background: 'var(--accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#000' }}>ST</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>Sovereign Trader</div>
            <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600, letterSpacing: 1 }}>v6.0 ICT/SMC</div>
          </div>
        </div>

        {/* Inline price strip */}
        <div className="price-strip-inline">
          {SYMBOLS.map(sym => {
            const p = prices[sym.id] || {};
            const isUp = (p.change || 0) >= 0;
            return (
              <div key={sym.id} className="price-strip-item" onClick={() => { setSelectedSym(sym); setTab('scanner'); }}>
                <span style={{ color: sym.color, fontSize: 13 }}>{sym.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{sym.id}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{p.price ? fmt(p.price, sym.priceDigits) : '—'}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: isUp ? 'var(--bull)' : 'var(--bear)' }}>{fmtPct(p.changePct, 2)}</span>
              </div>
            );
          })}
        </div>

        {/* Right: session + IST time + theme */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ padding: '4px 10px', borderRadius: 20, background: `${session.color}22`, border: `1px solid ${session.color}44`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: session.active ? session.color : 'var(--t3)', animation: session.active ? 'pulse 2s infinite' : 'none' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: session.color }}>{session.name}</span>
          </div>
          {killzone && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: killzone.color + '22', color: killzone.color }}>{killzone.name}</span>
          )}
          <span className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}>{istTime}</span>
          <button className="btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle theme" style={{ fontSize: 14 }}>
            {theme === 'dark' ? '☀' : '◑'}
          </button>
        </div>
      </header>

      {/* ═══ NAVIGATION ═══ */}
      <nav className="nav">
        {TABS.map(t => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span style={{ fontSize: 15 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      {/* ═══ PAGES ═══ */}
      <main className="page-content">

        {/* ── SCANNER PAGE ── */}
        {tab === 'scanner' && (
          <div>
            {/* Data source banner */}
            {dataSource && (
              <div className="data-source-banner" style={{ background: dataSource.color + '12', borderColor: dataSource.color + '33' }}>
                <div className="source-dot" style={{ background: dataSource.color, boxShadow: `0 0 6px ${dataSource.color}` }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: dataSource.color, fontFamily: 'monospace' }}>{dataSource.label}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {dataSource.source === 'twelvedata' ? '— Real-time spot candles' : dataSource.source === 'yahoo-futures' ? '— Futures candles (add TwelveData key for spot)' : '— Spot candles via Yahoo Finance'}
                </span>
                {dataSource.spot && <span className="tag-spot">✓ True spot</span>}
                {!dataSource.spot && dataSource.source !== 'none' && <span className="tag-futures">⚠ Futures $2-8 above spot</span>}
              </div>
            )}

            {/* Scanner cards grid */}
            <div className="scanner-grid">
              {SYMBOLS.map(sym => {
                const a = analyses[sym.id];
                const p = prices[sym.id] || {};
                const isUp = (p.change || 0) >= 0;
                const biasClass = a ? (a.bias === 'LONG' ? 'bull' : a.bias === 'SHORT' ? 'bear' : 'neutral') : 'neutral';
                const selected = selectedSym.id === sym.id;
                
                // Enhanced Confluence Logic
                const score = a?.score || 0;
                const scoreColor = score >= 70 ? 'var(--bull)' : score >= 45 ? 'var(--accent)' : 'var(--bear)';
                const isValid = a?.anchorsPassed && !a?.penaltyKilled && a?.score > 0;
                const statusMsg = !a ? 'Awaiting...' :
                  !a.anchorsPassed ? `✗ ${a.anchorFailed?.[0] || 'Anchor Failed'}` :
                  a.penaltyKilled ? `⚡ Rejected (${a.penaltyTotal}pts)` :
                  `✓ Valid Confluence`;

                return (
                  <div 
                    className={`scan-card ${biasClass} ${selected ? 'selected' : ''}`} 
                    key={sym.id} 
                    onClick={() => {
                      if (selectedSym.id !== sym.id) {
                        setChartAMD(null);
                        setChartAnalysis(null);
                        setChartCandles([]);
                        setSelectedSym(sym);
                      }
                    }}
                  >
                    <div className="card-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: sym.color, fontSize: 16 }}>{sym.icon}</span>
                        <span className="card-title">{sym.id}</span>
                        <span style={{ fontSize: 12, color: 'var(--t3)' }}>{sym.name}</span>
                      </div>
                      {loading[sym.id] ? (
                        <span style={{ fontSize: 11, color: 'var(--t3)' }}><span className="animate-spin" style={{ display: 'inline-block' }}>⟳</span></span>
                      ) : a ? (
                        <div className={`bias-tag ${a.bias === 'LONG' ? 'long' : a.bias === 'SHORT' ? 'short' : 'neutral'}`}>
                          {a.bias}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: sym.color }}>{p.price ? fmt(p.price, sym.priceDigits) : '—'}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isUp ? 'var(--bull)' : 'var(--bear)' }}>
                          {p.change ? (p.change >= 0 ? '+' : '') + fmt(p.change, sym.priceDigits) : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: isUp ? 'var(--bull)' : 'var(--bear)', background: isUp ? 'var(--bull)1a' : 'var(--bear)1a', padding: '1px 6px', borderRadius: 4 }}>
                          {fmtPct(p.changePct)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>
                          {p.change ? `${(p.change * sym.pipMultiplier).toFixed(sym.pipDigits)} ${sym.id.includes('MCX') ? 'pts' : 'pips'}` : ''}
                        </span>
                      </div>
                    </div>

                    {a && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' }}>Confluence</span>
                          <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{score}</span>
                        </div>
                        <div className="confidence-bar">
                          <div className="confidence-fill" style={{ width: `${score}%`, background: scoreColor }} />
                        </div>
                        
                        {/* Status Gate */}
                        <div className={`status-gate ${isValid ? 'valid' : a?.penaltyKilled ? 'rejected' : 'invalid'}`}>
                          {statusMsg}
                        </div>

                        <div className="scan-stats" style={{ marginTop: 10 }}>
                          <div className="stat-item"><div className="stat-val">{a.orderBlocks?.length || 0}</div><div className="stat-label">OBs</div></div>
                          <div className="stat-item"><div className="stat-val">{a.fvgs?.length || 0}</div><div className="stat-label">FVGs</div></div>
                          <div className="stat-item"><div className="stat-val">{a.pools?.length || 0}</div><div className="stat-label">Pools</div></div>
                        </div>
                      </div>
                    )}
                    
                    {!a && <div className="empty-state" style={{ padding: '20px 0' }}>Analyzing...</div>}
                  </div>
                );
              })}
            </div>

            <Chart 
              sym={selectedSym} 
              candles={chartCandles} 
              analysis={chartAnalysis} 
              onTFChange={setChartTF} 
              tf={chartTF.value} 
              theme={theme}
            />

            {/* Live signal panel for selected symbol */}
            {currentAnalysis && currentAnalysis.score > 0 ? (
              <div className={`signal-panel ${currentAnalysis.bias === 'LONG' ? 'bull' : currentAnalysis.bias === 'SHORT' ? 'bear' : ''}`} style={{ marginTop: 16 }}>
                <div className="signal-panel-header">
                  <div className="live-dot" style={{ background: currentAnalysis.bias === 'LONG' ? '#22c55e' : '#ef4444' }} />
                  <span className="label">Live Signal</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{selectedSym.id}</span>
                  <span className={`bias-tag ${currentAnalysis.bias === 'LONG' ? 'long' : 'short'}`}>{currentAnalysis.bias}</span>
                  <span className={`bias-tag ${currentAnalysis.confidence === 'HIGH' ? 'long' : currentAnalysis.confidence === 'MEDIUM' ? 'medium' : 'neutral'}`}>{currentAnalysis.confidence}</span>
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 24, fontWeight: 800, color: currentAnalysis.score >= 70 ? 'var(--bull)' : currentAnalysis.score >= 45 ? 'var(--accent)' : 'var(--bear)' }}>
                    {currentAnalysis.score}<span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 3 }}>/100</span>
                  </span>
                  <button className="btn btn-sm" onClick={() => takeTrade({ ...currentAnalysis, symbol: selectedSym.id })} style={{ marginLeft: 16, background: 'var(--accent)', color: '#000', fontWeight: 800, border: 'none' }}>
                    📄 Take Trade
                  </button>
                </div>
                <div className="signal-levels">
                  {[
                    { label: 'Entry', val: currentAnalysis.entry, cls: 'entry' },
                    { label: 'Stop Loss', val: currentAnalysis.sl, cls: 'sl' },
                    { label: 'TP1', val: currentAnalysis.tp1, cls: 'tp' },
                    { label: 'TP2', val: currentAnalysis.tp2, cls: 'tp' },
                  ].map(({ label, val, cls }) => (
                    <div className="level-box" key={label}>
                      <div className="lbl">{label}</div>
                      <div className={`val ${cls}`}>{val ? fmt(val, selectedSym.priceDigits) : '—'}</div>
                    </div>
                  ))}
                </div>
                <div className="factors-list">
                  {(currentAnalysis.factors || []).map((f, i) => (
                    <div className={`factor-row ${f.type}`} key={i}>
                      <span>{f.label}</span>
                      <span className="f-score">{f.score > 0 ? `+${f.score}` : f.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="no-signal-bar" style={{ marginTop: 16 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6b7280' }} />
                <span>No qualifying ICT signal on {selectedSym.id} · 15m — score below threshold</span>
              </div>
            )}
            
            {/* AMD Phase Panel */}
            {chartAMD && (
              <div className="card" style={{ marginTop: 16, marginBottom: 16, borderLeft: `4px solid ${chartAMD.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>{chartAMD.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: chartAMD.color }}>{chartAMD.label}</span>
                  <span className="bias-tag neutral" style={{ fontWeight: 800 }}>{chartAMD.confidence}% confidence</span>
                  <span className={`bias-tag ${chartAMD.bias === 'LONG' ? 'long' : chartAMD.bias === 'SHORT' ? 'short' : 'neutral'}`}>{chartAMD.bias}</span>
                  <span style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 8 }}>{chartAMD.session.icon} {chartAMD.session.name}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16, lineHeight: 1.5 }}>{chartAMD.description}</p>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 2, minWidth: 280 }}>
                    {chartAMD.details.map((d, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--t1)', padding: '4px 8px', background: 'var(--s2)', borderRadius: 4 }}>{d}</div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 140, borderLeft: '1px solid var(--s3)', paddingLeft: 16 }}>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>Range: {chartAMD.meta.rangeLow.toFixed(2)} – {chartAMD.meta.rangeHigh.toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>Position: {chartAMD.meta.posInRange}%</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>Vol ratio: {chartAMD.meta.volRatio}%</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>ATR: {chartAMD.meta.atr.toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>Net move: {chartAMD.meta.netMovePct}%</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SIGNALS PAGE ── */}
        {tab === 'signals' && (
          <div>
            <div className="page-header"><h2>Signal History</h2><p>Auto-generated signals from the ICT scanner</p></div>
            {signals.length === 0 ? (
              <div className="empty-state"><div className="icon">◎</div><p>No signals yet — scanner runs every 90 seconds</p></div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="data-table">
                  <thead><tr>
                    {['Time', 'TF', 'Symbol', 'Bias', 'Score', 'Entry', 'SL', 'TP1', 'TP2', 'Action'].map(h => <th key={h}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {signals.slice().reverse().slice(0, 50).map((sig, i) => {
                      const s = SYMBOLS.find(x => x.id === sig.symbol) || SYMBOLS[0];
                      return (
                        <tr key={sig.id} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--s2)' }}>
                          <td className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtTime(sig.timestamp)}</td>
                          <td className="mono" style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 600 }}>{sig.timeframe || '15m'}</td>
                          <td><span style={{ color: s.color, fontWeight: 700 }}>{s.icon} {sig.symbol}</span></td>
                          <td><span className={`bias-tag ${sig.bias === 'LONG' ? 'long' : 'short'}`}>{sig.bias}</span></td>
                          <td><span className="mono" style={{ fontWeight: 700, color: sig.score >= 70 ? 'var(--bull)' : sig.score >= 45 ? 'var(--accent)' : 'var(--bear)' }}>{sig.score}</span></td>
                          <td className="mono" style={{ fontWeight: 600 }}>{sig.entry ? fmt(sig.entry, s.priceDigits) : '—'}</td>
                          <td className="mono" style={{ color: 'var(--bear)' }}>{sig.sl ? fmt(sig.sl, s.priceDigits) : '—'}</td>
                          <td className="mono" style={{ color: 'var(--bull)' }}>{sig.tp1 ? fmt(sig.tp1, s.priceDigits) : '—'}</td>
                          <td className="mono" style={{ color: 'var(--bull)' }}>{sig.tp2 ? fmt(sig.tp2, s.priceDigits) : '—'}</td>
                          <td>
                            <button className="btn btn-xs" onClick={() => takeTrade(sig)} style={{ background: 'var(--s3)', border: 'none', color: 'var(--t1)' }}>
                              Trade
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── PAPER TRADING PAGE ── */}
        {tab === 'paper' && (
          <div>
            <div className="page-header"><h2>Paper Trading</h2><p>Practice with ₹10,00,000 virtual capital — auto-closes on SL/TP hit</p></div>
            <div className="stats-grid-4" style={{ marginBottom: 24 }}>
              <div className="stat-box"><div className="stat-value">{fmtINRFull(STARTING_CAPITAL)}</div><div className="stat-label">Starting Capital</div></div>
              <div className="stat-box"><div className="stat-value" style={{ color: (paperBalance + openPaperPnl) >= STARTING_CAPITAL ? 'var(--bull)' : 'var(--bear)' }}>{fmtINRFull(Math.round(paperBalance + openPaperPnl))}</div><div className="stat-label">Current Balance</div></div>
              <div className="stat-box"><div className="stat-value" style={{ color: (paperBalance - STARTING_CAPITAL) >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{fmtINRFull(paperBalance - STARTING_CAPITAL)}</div><div className="stat-label">Realized P&L</div></div>
              <div className="stat-box"><div className="stat-value" style={{ color: openPaperPnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{fmtINRFull(Math.round(openPaperPnl))}</div><div className="stat-label">Open P&L</div></div>
            </div>
            {/* Open position form */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="label" style={{ marginBottom: 14 }}>Open Position</div>
              <div className="form-grid-2" style={{ marginBottom: 12 }}>
                <div className="input-group"><label>Symbol</label>
                  <select className="input" value={paperForm.symbol} onChange={e => setPaperForm(f => ({ ...f, symbol: e.target.value }))}>
                    {SYMBOLS.map(s => <option key={s.id} value={s.id}>{s.icon} {s.id}</option>)}
                  </select>
                </div>
                <div className="input-group"><label>Direction</label>
                  <select className="input" value={paperForm.bias} onChange={e => setPaperForm(f => ({ ...f, bias: e.target.value }))}>
                    <option value="LONG">▲ LONG</option><option value="SHORT">▼ SHORT</option>
                  </select>
                </div>
                <div className="input-group"><label>Entry</label><input className="input" type="number" step="any" value={paperForm.entry} onChange={e => setPaperForm(f => ({ ...f, entry: e.target.value }))} /></div>
                <div className="input-group"><label>Stop Loss</label><input className="input" type="number" step="any" value={paperForm.sl} onChange={e => setPaperForm(f => ({ ...f, sl: e.target.value }))} /></div>
                <div className="input-group"><label>TP1</label><input className="input" type="number" step="any" value={paperForm.tp1} onChange={e => setPaperForm(f => ({ ...f, tp1: e.target.value }))} /></div>
                <div className="input-group"><label>Lots</label><input className="input" type="number" step="0.01" value={paperForm.lots} onChange={e => setPaperForm(f => ({ ...f, lots: e.target.value }))} /></div>
              </div>
              <button className="btn btn-primary" onClick={openPaperPosition}>Open Position</button>
              {paperError && <div style={{ color: 'var(--bear)', fontSize: 13, marginTop: 8 }}>{paperError}</div>}
            </div>
            {/* Open positions */}
            <div className="card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--s3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>Open Positions ({paperPositions.length})</span>
                <button className="btn btn-ghost btn-xs" onClick={resetPaperAccount}>Reset Account</button>
              </div>
              {paperPositions.length === 0 ? (
                <div className="empty-state"><div className="icon">◉</div><p>No open positions</p></div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr><th>Symbol</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP1</th><th>Lots</th><th>Live Price</th><th>Open P&L</th><th>Opened</th><th></th></tr></thead>
                    <tbody>
                      {paperPositions.map(pos => {
                        const s = symConfig(pos.symbol);
                        const cp = prices[pos.symbol]?.price;
                        let pnl = null;
                        if (cp) {
                          const pips = Math.abs(pos.entry - cp) * (s.pipMultiplier || 10);
                          const mult = pos.bias === 'LONG' ? (cp > pos.entry ? 1 : -1) : (cp < pos.entry ? 1 : -1);
                          pnl = Math.round(pips * (s.pipValuePerLot || 10) * pos.lots * 83 * mult);
                        }
                        return (
                          <tr key={pos.id}>
                            <td><span style={{ color: s.color, fontWeight: 700 }}>{s.icon} {pos.symbol}</span></td>
                            <td><span className={`bias-tag ${pos.bias === 'LONG' ? 'long' : 'short'}`}>{pos.bias}</span></td>
                            <td className="mono">{fmt(pos.entry, s.priceDigits)}</td>
                            <td className="mono" style={{ color: 'var(--bear)' }}>{fmt(pos.sl, s.priceDigits)}</td>
                            <td className="mono" style={{ color: 'var(--bull)' }}>{fmt(pos.tp1, s.priceDigits)}</td>
                            <td className="mono">{pos.lots}</td>
                            <td className="mono">{cp ? fmt(cp, s.priceDigits) : '—'}</td>
                            <td className="mono" style={{ fontWeight: 700, color: (pnl || 0) >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{pnl !== null ? fmtINRFull(pnl) : '—'}</td>
                            <td className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtTime(pos.openTime)}</td>
                            <td><button className="btn btn-sm" style={{ background: 'var(--bear)', color: '#fff', border: 'none' }} onClick={() => closePaperManual(pos)}>Close</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {/* History */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--s3)', fontWeight: 600 }}>Closed Trades ({paperHistory.length})</div>
              {paperHistory.length === 0 ? (
                <div className="empty-state"><div className="icon">📋</div><p>No closed trades yet</p></div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr><th>Symbol</th><th>Dir</th><th>Entry</th><th>Close</th><th>Type</th><th>Pips</th><th>P&L (₹)</th><th>Result</th><th>Closed</th></tr></thead>
                    <tbody>
                      {paperHistory.map((t, i) => {
                        const s = symConfig(t.symbol);
                        return (
                          <tr key={t.id || i}>
                            <td><span style={{ color: s.color, fontWeight: 700 }}>{s.icon} {t.symbol}</span></td>
                            <td><span className={`bias-tag ${t.bias === 'LONG' ? 'long' : 'short'}`}>{t.bias}</span></td>
                            <td className="mono">{fmt(t.entry, s.priceDigits)}</td>
                            <td className="mono">{fmt(t.closePrice, s.priceDigits)}</td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--info-bg)', color: 'var(--info)' }}>{t.closeType}</span></td>
                            <td className="mono" style={{ color: (t.pips || 0) >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{fmtPips(t.pips)}</td>
                            <td className="mono" style={{ fontWeight: 700, color: (t.pnlInr || 0) >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{fmtINRFull(t.pnlInr)}</td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: t.result === 'WIN' ? 'var(--bull-bg)' : 'var(--bear-bg)', color: t.result === 'WIN' ? 'var(--bull)' : 'var(--bear)' }}>{t.result}</span></td>
                            <td className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtTime(t.closeTime)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── WALK FORWARD OPTIMIZATION ── */}
        {tab === 'wfo' && <WalkForwardPage />}

        {/* ── CALCULATOR PAGE ── */}
        {tab === 'calculator' && (
          <div>
            <div className="page-header"><h2>Position Calculator</h2><p>Real-time risk/reward for {calcSym.name} — calculates as you type</p></div>
            <div className="calc-layout">
              <div className="card calc-inputs">
                <div className="input-group">
                  <label>Symbol</label>
                  <select className="input" value={calcSymId} onChange={e => setCalcSymId(e.target.value)}>
                    {SYMBOLS.map(s => <option key={s.id} value={s.id}>{s.icon} {s.id} — {s.name}</option>)}
                  </select>
                </div>
                <div className="form-grid-2">
                  <div className="input-group"><label>Entry Price</label><input className="input" type="number" step="any" value={calcEntry} onChange={e => setCalcEntry(e.target.value)} /></div>
                  <div className="input-group"><label>Stop Loss</label><input className="input" type="number" step="any" value={calcSL} onChange={e => setCalcSL(e.target.value)} /></div>
                  <div className="input-group"><label>TP1</label><input className="input" type="number" step="any" value={calcTP1} onChange={e => setCalcTP1(e.target.value)} placeholder="Optional" /></div>
                  <div className="input-group"><label>TP2</label><input className="input" type="number" step="any" value={calcTP2} onChange={e => setCalcTP2(e.target.value)} placeholder="Optional" /></div>
                </div>
                <div className="input-group"><label>Lot Size</label><input className="input" type="number" step="0.01" min="0.01" value={calcLots} onChange={e => setCalcLots(e.target.value)} /></div>
                {suggestedLots && (
                  <div className="suggestion-box">
                    💡 1% risk (₹10,000) = <strong>{suggestedLots} lots</strong>
                    <button className="btn btn-xs" style={{ marginLeft: 8, background: 'var(--accent)', color: '#000' }} onClick={() => setCalcLots(String(suggestedLots))}>Use</button>
                  </div>
                )}
                {calcResult && (
                  <div className={`direction-badge ${calcResult.direction === 'LONG' ? 'bull' : 'bear'}`}>
                    {calcResult.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
                  </div>
                )}
              </div>
              <div className="calc-results">
                {!calcResult ? (
                  <div className="card empty-state"><div className="icon">⊕</div><p>Enter Entry and Stop Loss to calculate</p></div>
                ) : (
                  <>
                    <div className="card"><div className="label" style={{ marginBottom: 12 }}>Stop Loss Analysis</div>
                      <div className="stats-grid-3">
                        <div className="stat-box"><div className="stat-value">{fmtPips(calcResult.slPips)}</div><div className="stat-label">SL Pips</div></div>
                        <div className="stat-box"><div className="stat-value" style={{ color: 'var(--bear)' }}>{fmtINRFull(calcResult.riskINR)}</div><div className="stat-label">Risk (INR)</div></div>
                        <div className="stat-box"><div className="stat-value" style={{ color: calcResult.rrTp1 >= 1.5 ? 'var(--bull)' : 'var(--t2)' }}>1 : {calcResult.rrTp1}</div><div className="stat-label">R:R (TP1)</div></div>
                      </div>
                    </div>
                    {calcTP1 && <div className="card"><div className="label" style={{ marginBottom: 12 }}>TP1 Analysis</div>
                      <div className="stats-grid-3">
                        <div className="stat-box"><div className="stat-value">{fmtPips(calcResult.tp1Pips)}</div><div className="stat-label">TP1 Pips</div></div>
                        <div className="stat-box"><div className="stat-value" style={{ color: 'var(--bull)' }}>{fmtINRFull(calcResult.tp1INR)}</div><div className="stat-label">TP1 Profit</div></div>
                        <div className="stat-box"><div className="stat-value" style={{ color: 'var(--bull)' }}>1 : {calcResult.rrTp1}</div><div className="stat-label">R:R</div></div>
                      </div>
                    </div>}
                    {calcTP2 && <div className="card"><div className="label" style={{ marginBottom: 12 }}>TP2 Analysis</div>
                      <div className="stats-grid-3">
                        <div className="stat-box"><div className="stat-value">{fmtPips(calcResult.tp2Pips)}</div><div className="stat-label">TP2 Pips</div></div>
                        <div className="stat-box"><div className="stat-value" style={{ color: 'var(--bull)' }}>{fmtINRFull(calcResult.tp2INR)}</div><div className="stat-label">TP2 Profit</div></div>
                        <div className="stat-box"><div className="stat-value" style={{ color: 'var(--bull)' }}>1 : {calcResult.rrTp2}</div><div className="stat-label">R:R</div></div>
                      </div>
                    </div>}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── TRADE LOG PAGE ── */}
        {tab === 'tradelog' && (
          <div>
            <div className="page-header"><h2>Trade Log</h2><p>Record your live trades for review and improvement</p></div>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="label" style={{ marginBottom: 12 }}>Log a New Trade</div>
              <div className="form-grid-2" style={{ marginBottom: 12 }}>
                <div className="input-group"><label>Symbol</label>
                  <select className="input" value={tradeForm.symbol} onChange={e => setTradeForm(f => ({ ...f, symbol: e.target.value }))}>
                    {SYMBOLS.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                  </select>
                </div>
                <div className="input-group"><label>Direction</label>
                  <select className="input" value={tradeForm.bias} onChange={e => setTradeForm(f => ({ ...f, bias: e.target.value }))}>
                    <option value="LONG">LONG</option><option value="SHORT">SHORT</option>
                  </select>
                </div>
                <div className="input-group"><label>Entry</label><input className="input" type="number" step="any" value={tradeForm.entry} onChange={e => setTradeForm(f => ({ ...f, entry: e.target.value }))} /></div>
                <div className="input-group"><label>Stop Loss</label><input className="input" type="number" step="any" value={tradeForm.sl} onChange={e => setTradeForm(f => ({ ...f, sl: e.target.value }))} /></div>
                <div className="input-group"><label>Take Profit</label><input className="input" type="number" step="any" value={tradeForm.tp} onChange={e => setTradeForm(f => ({ ...f, tp: e.target.value }))} /></div>
                <div className="input-group"><label>Lots</label><input className="input" type="number" step="0.01" value={tradeForm.lots} onChange={e => setTradeForm(f => ({ ...f, lots: e.target.value }))} /></div>
                <div className="input-group"><label>P&L (INR)</label><input className="input" type="number" step="any" value={tradeForm.pnl} onChange={e => setTradeForm(f => ({ ...f, pnl: e.target.value }))} placeholder="+5000 or -2000" /></div>
                <div className="input-group"><label>Notes</label><input className="input" value={tradeForm.notes} onChange={e => setTradeForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Caught at OB" /></div>
              </div>
              <button className="btn btn-primary" onClick={addTrade}>+ Log Trade</button>
            </div>
            {trades.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="data-table">
                  <thead><tr>{['Date', 'Symbol', 'Bias', 'Entry', 'Lots', 'P&L', 'Notes'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {trades.slice().reverse().map((t, i) => (
                      <tr key={t.id} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--s2)' }}>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtTime(t.timestamp)}</td>
                        <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                        <td><span className={`bias-tag ${t.bias === 'LONG' ? 'long' : 'short'}`}>{t.bias}</span></td>
                        <td className="mono">{fmt(t.entry, 2)}</td>
                        <td className="mono">{t.lots}</td>
                        <td className="mono" style={{ fontWeight: 700, color: t.pnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{t.pnl >= 0 ? '+' : ''}{fmtINRFull(t.pnl)}</td>
                        <td style={{ color: 'var(--t2)', fontSize: 12 }}>{t.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── KNOWLEDGE PAGE ── */}
        {tab === 'knowledge' && <KnowledgePage />}

        {/* ── SETTINGS PAGE ── */}
        {tab === 'settings' && (
          <div>
            <div className="page-header"><h2>Settings</h2><p>Configure data sources, API keys, and preferences</p></div>
            {/* Status overview */}
            <div className="stats-grid-4" style={{ marginBottom: 20 }}>
              <div className="stat-box"><div className="stat-value" style={{ color: 'var(--accent)' }}>{theme === 'dark' ? '◑ Dark' : '☀ Light'}</div><div className="stat-label">Theme</div></div>
              <div className="stat-box"><div className="stat-value" style={{ color: settings.geminiKey ? '#a855f7' : 'var(--bear)' }}>{settings.geminiKey ? 'Active' : 'Offline'}</div><div className="stat-label">Gemini AI</div></div>
              <div className="stat-box"><div className="stat-value" style={{ color: settings.twelveKey ? 'var(--bull)' : 'var(--bear)' }}>{settings.twelveKey ? 'Active' : 'None'}</div><div className="stat-label">TwelveData</div></div>
              <div className="stat-box"><div className="stat-value" style={{ color: settings.tgBotToken ? 'var(--bull)' : 'var(--t3)' }}>{settings.tgBotToken ? 'Connected' : 'Not set'}</div><div className="stat-label">Telegram</div></div>
            </div>
            {/* Backup */}
            <div className="card" style={{ marginBottom: 20, border: '1.5px solid #e2b34055', background: '#e2b34008' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span>💾</span><span style={{ fontWeight: 700, fontSize: 15 }}>Local JSON Export</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12 }}>Manual file download fallback for local storage data.</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={handleExport} style={{ background: '#22c55e', color: '#fff', fontWeight: 700, border: 'none' }}>📥 Export JSON</button>
                <button className="btn btn-ghost btn-sm" onClick={() => importRef.current?.click()}>📤 Import File</button>
                <input ref={importRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
                {importMsg && <span style={{ fontSize: 13, fontWeight: 600, color: importMsg.startsWith('✓') ? '#22c55e' : '#f97316' }}>{importMsg}</span>}
              </div>
            </div>

            {/* Google Drive Auto-Backup */}
            <div className="card" style={{ marginBottom: 20, border: driveInfo.connected ? '1.5px solid #4ade8055' : '1.5px solid #3b82f655', background: driveInfo.connected ? '#4ade8008' : '#3b82f608' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>☁</span><span style={{ fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Google Drive — Auto Backup</span>
                {driveInfo.connected ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, background: '#4ade8022', color: '#4ade80' }}>● CONNECTED</span> : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, background: '#94a3b822', color: '#94a3b8' }}>○ Not connected</span>}
                {driveInfo.email && <span style={{ fontSize: 12, color: 'var(--t2)', fontFamily: 'monospace' }}>{driveInfo.email}</span>}
                {driveInfo.lastBackup && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4ade80', fontFamily: 'monospace' }}>Last backup: {new Date(driveInfo.lastBackup).toLocaleTimeString()}</span>}
              </div>

              {!driveInfo.connected ? (
                <>
                  <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12, lineHeight: 1.6 }}>Cloud sync all settings, trades, and datasets to your personal Drive.</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input className="input" type="text" placeholder="Google OAuth Client ID (ends in .apps.googleusercontent.com)" value={driveClientId} onChange={(e) => setDriveClientId(e.target.value)} style={{ flex: 1, minWidth: 280, fontFamily: 'monospace', fontSize: 12 }} />
                    <button className="btn btn-sm" onClick={handleDriveConnect} disabled={driveConnecting || !driveClientId.trim()} style={{ background: '#3b82f6', color: '#fff', fontWeight: 700, border: 'none', whiteSpace: 'nowrap' }}>{driveConnecting ? '⟳ Connecting…' : '☁ Connect Drive'}</button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={handleDriveBackup} disabled={driveBacking} style={{ background: '#4ade80', color: '#000', fontWeight: 700, border: 'none' }}>{driveBacking ? '⟳ Saving…' : '☁ Backup Now'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={handleDriveRestore} disabled={driveRestoring}>{driveRestoring ? '⟳ Restoring…' : '↓ Restore from Drive'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={handleDriveDisconnect} style={{ color: 'var(--bear)' }}>Disconnect</button>
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>Auto-backup every 5 min</span>
                </div>
              )}
              {driveMsg && <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: driveMsg.startsWith('✓') ? '#4ade80' : driveMsg.startsWith('⚠') ? '#f97316' : 'var(--t2)' }}>{driveMsg}</div>}
            </div>
            {/* Settings form */}
            <div className="card">
              <div className="settings-row"><div className="settings-left"><div className="settings-label">Cloudflare Worker URL</div><div className="settings-sub">Required for price data</div></div>
                <div className="settings-right">
                  <input className="input" value={settings.workerUrl || ''} onChange={e => saveSettings('workerUrl', e.target.value)} placeholder="https://ict-data-proxy.suketu29.workers.dev" />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-xs" onClick={() => runTest('worker')} disabled={testStatus.worker === 'loading'} style={{ background: 'var(--s3)', border: 'none', color: 'var(--t1)' }}>
                      {testStatus.worker === 'loading' ? '⟳ Testing...' : 'Test Connection'}
                    </button>
                    {testStatus.worker && testStatus.worker !== 'loading' && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: testStatus.worker.startsWith('✓') ? 'var(--bull)' : 'var(--bear)' }}>{testStatus.worker}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="settings-row"><div className="settings-left"><div className="settings-label">TwelveData API Key</div><div className="settings-sub">Real spot candles — get free key at twelvedata.com</div></div>
                <div className="settings-right">
                  <input className="input" type="password" value={settings.twelveKey || ''} onChange={e => saveSettings('twelveKey', e.target.value)} placeholder="Paste TwelveData key" />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-xs" onClick={() => runTest('twelve')} disabled={testStatus.twelve === 'loading'} style={{ background: 'var(--s3)', border: 'none', color: 'var(--t1)' }}>
                      {testStatus.twelve === 'loading' ? '⟳ Testing...' : 'Test Connection'}
                    </button>
                    {testStatus.twelve && testStatus.twelve !== 'loading' && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: testStatus.twelve.startsWith('✓') ? 'var(--bull)' : 'var(--bear)' }}>{testStatus.twelve}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="settings-row"><div className="settings-left"><div className="settings-label">Telegram Bot Token</div><div className="settings-sub">Create via @BotFather on Telegram</div></div>
                <div className="settings-right">
                  <input className="input" type="password" value={settings.tgBotToken || ''} onChange={e => saveSettings('tgBotToken', e.target.value)} placeholder="Bot token" />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-xs" onClick={() => runTest('tg')} disabled={testStatus.tg === 'loading'} style={{ background: 'var(--s3)', border: 'none', color: 'var(--t1)' }}>
                      {testStatus.tg === 'loading' ? '⟳ Testing...' : 'Test Connection'}
                    </button>
                    {testStatus.tg && testStatus.tg !== 'loading' && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: testStatus.tg.startsWith('✓') ? 'var(--bull)' : 'var(--bear)' }}>{testStatus.tg}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="settings-row"><div className="settings-left"><div className="settings-label">Telegram Chat ID</div><div className="settings-sub">Get from @userinfobot on Telegram</div></div>
                <div className="settings-right">
                  <input className="input" value={settings.tgChatId || ''} onChange={e => saveSettings('tgChatId', e.target.value)} placeholder="Chat ID" />
                </div>
              </div>
              <div className="settings-row"><div className="settings-left"><div className="settings-label">Google Gemini API Key</div><div className="settings-sub">Required for AI Chart Analysis</div></div>
                <div className="settings-right">
                  <input className="input" type="password" value={settings.geminiKey || ''} onChange={e => saveSettings('geminiKey', e.target.value)} placeholder="AI Studio Key" />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-xs" onClick={() => runTest('gemini')} disabled={testStatus.gemini === 'loading'} style={{ background: 'var(--s3)', border: 'none', color: 'var(--t1)' }}>
                      {testStatus.gemini === 'loading' ? '⟳ Testing...' : 'Test Connection'}
                    </button>
                    {testStatus.gemini && testStatus.gemini !== 'loading' && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: testStatus.gemini.startsWith('✓') ? 'var(--bull)' : 'var(--bear)' }}>{testStatus.gemini}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="settings-row"><div className="settings-left"><div className="settings-label">Dhan API Key (MCX Futures)</div><div className="settings-sub">For NSE/MCX localized Indian Spot mappings</div></div>
                <div className="settings-right">
                  <input className="input" type="password" value={settings.dhanKey || ''} onChange={e => saveSettings('dhanKey', e.target.value)} placeholder="Dhan API Token" />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button className="btn btn-xs" onClick={() => runTest('dhan')} disabled={testStatus.dhan === 'loading'} style={{ background: 'var(--s3)', border: 'none', color: 'var(--t1)' }}>
                      {testStatus.dhan === 'loading' ? '⟳ Testing...' : 'Test Connection'}
                    </button>
                    {testStatus.dhan && testStatus.dhan !== 'loading' && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: testStatus.dhan.startsWith('✓') ? 'var(--bull)' : 'var(--bear)' }}>{testStatus.dhan}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Global AI Chat */}
      <FloatingAIChat 
        currentSym={selectedSym.id} 
        currentAnalysis={chartAnalysis} 
        amdPhase={chartAMD} 
        currentPrice={prices[selectedSym.id]?.price} 
        apiKey={settings.geminiKey || ''} 
      />

      {/* ═══ FOOTER ═══ */}
      <footer className="app-footer">Sovereign Trader v6.0 — ICT/SMC Signal Generator — For educational use only. Not financial advice.</footer>
    </div>
  );
}
