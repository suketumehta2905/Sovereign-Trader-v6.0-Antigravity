import React, { useEffect, useRef, useState } from 'react';
import { detectBOSCHOCH } from '../engine/bosDetector';
import { detectTrendlines } from '../engine/trendlineDetector';
import { detectLiquidity } from '../engine/liquidityDetector';
import { AdvancedSRDetector } from '../engine/advancedSR';
import { lsGet, lsSet } from '../utils/localStorage';

const LW_CDN = 'https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js';

// Load LW Charts script exactly once
let lwPromise = null;
function loadLWCharts() {
  if (lwPromise) return lwPromise;
  lwPromise = new Promise((resolve, reject) => {
    if (window.LightweightCharts) { resolve(window.LightweightCharts); return; }
    const s = document.createElement('script');
    s.src     = LW_CDN;
    s.async   = true;
    s.onload  = () => window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error('LW not found on window'));
    s.onerror = () => reject(new Error('Script failed to load'));
    document.head.appendChild(s);
  });
  return lwPromise;
}

const TIMEFRAMES = [
  { label: '1m',  value: '1m',  range: '3d',   aggregate: null },
  { label: '5m',  value: '5m',  range: '30d',  aggregate: null },
  { label: '15m', value: '15m', range: '60d',  aggregate: null },
  { label: '1h',  value: '1h',  range: '180d', aggregate: null },
  { label: '1D',  value: '1d',  range: '5y',   aggregate: null },
];

const TIMEZONES = [
  { label: 'IST',  tz: 'Asia/Kolkata',      offset: '+5:30' },
  { label: 'UTC',  tz: 'UTC',               offset: '+0:00' },
  { label: 'LON',  tz: 'Europe/London',     offset: '+0/+1' },
  { label: 'NYC',  tz: 'America/New_York',  offset: '-5/-4' },
  { label: 'SGT',  tz: 'Asia/Singapore',    offset: '+8:00' },
  { label: 'TYO',  tz: 'Asia/Tokyo',        offset: '+9:00' },
  { label: 'SYD',  tz: 'Australia/Sydney',  offset: '+10/+11' },
];

const TZ_LS_KEY = 'st_chart_tz';

/** Build LW Charts localization formatters for a given IANA timezone */
function makeTimeFormatters(tz) {
  const fmt = (ts, opts) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(ts * 1000));
    } catch { return ''; }
  };
  return {
    timeFormatter: (ts) => fmt(ts, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
    tickMarkFormatter: (ts, type) => {
      // type: 0=year 1=month 2=dayOfMonth 3=time 4=timeWithSeconds
      if (type <= 1) return fmt(ts, { year: 'numeric', month: 'short' });
      if (type === 2) return fmt(ts, { month: 'short', day: '2-digit' });
      return fmt(ts, { hour: '2-digit', minute: '2-digit', hour12: false });
    },
  };
}

const ZONE_BUTTONS = [
  { key: 'demand',   label: 'Demand',      color: '#22c55e' },
  { key: 'supply',   label: 'Supply',      color: '#ef4444' },
  { key: 'fvg',     label: 'FVG',         color: '#3b82f6' },
  { key: 'ifvg',    label: 'IFVG',        color: '#a78bfa' },
  { key: 'srZones', label: 'SR Zones',      color: '#06b6d4' },
  { key: 'autoTL',  label: 'Auto TL',       color: '#fbbf24' },
  { key: 'pd',      label: 'P/D',           color: '#a855f7' },
  { key: 'liq',     label: 'LIQ',           color: '#f97316' },
  { key: 'bos',     label: 'BOS',           color: '#e2b340' },
  { key: 'analysis',label: 'Entry/SL/TP',   color: '#e2b340' },
];

function getChartColors(theme) {
  const isDark = theme !== 'light';
  return {
    bg:     isDark ? '#070b0f' : '#ffffff',
    text:   isDark ? '#8899aa' : '#475569',
    grid:   isDark ? '#1e2a3a' : '#f1f5f9',
    border: isDark ? '#1e2a3a' : '#f1f5f9',
  };
}

// ── LW Charts Zone Primitive ──────────────────────────────────────────────────
// Draws coloured zone rectangles directly on the chart canvas.
// Uses the ISeriesPrimitive API (LW Charts v4.0+).

class ZoneRenderer {
  constructor(getState) {
    this._getState = getState;
  }

  draw(target) {
    const { chart, series, zones } = this._getState();
    if (!zones || zones.length === 0 || !chart || !series) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W         = mediaSize.width;
      const H         = mediaSize.height;
      const timeScale = chart.timeScale();

      for (const z of zones) {
        // ── X coordinates ─────────────────────────────────────────────────────
        // CRITICAL FIX: when startTime is before the visible chart range,
        // timeToCoordinate() returns null — we draw from x=0 (left edge) instead of skipping.
        const x1raw = timeScale.timeToCoordinate(z.startTime);
        const x1 = x1raw !== null ? Math.max(0, Math.round(x1raw)) : 0;

        const x2raw = z.endTime ? timeScale.timeToCoordinate(z.endTime) : null;
        const x2    = x2raw !== null ? Math.round(x2raw) : W;

        if (x2 <= x1) continue;

        // ── Y coordinates ─────────────────────────────────────────────────────
        const ytRaw = series.priceToCoordinate(z.top);
        const ybRaw = series.priceToCoordinate(z.bottom);
        if (ytRaw === null || ybRaw === null) continue;

        const top    = Math.round(Math.min(ytRaw, ybRaw));
        const bottom = Math.round(Math.max(ytRaw, ybRaw));

        // Skip zones entirely off-screen vertically
        if (bottom < 0 || top > H) continue;

        const topClipped    = Math.max(0, top);
        const bottomClipped = Math.min(H, bottom);
        const h  = Math.max(bottomClipped - topClipped, 4);
        const w  = x2 - x1;

        const mit      = z.mitigation || 'fresh';
        const isFresh  = mit === 'fresh';
        const isTested = mit === 'tested';
        const isBroken = mit === 'broken';

        // Colour scheme — broken uses muted blue-grey instead of disappearing
        const baseColor  = isBroken ? '#64748b' : z.color;
        const fillAlpha  = isFresh ? 0.22 : isTested ? 0.16 : 0.12;
        const borderAlpha= isFresh ? 1.00 : isTested ? 0.75 : 0.55;
        const stripeW    = isFresh ? 5 : isTested ? 4 : 3;
        const borderW    = isFresh ? 2 : 1.5;
        const lineDash   = isFresh ? [] : isTested ? [7, 4] : [4, 6];

        ctx.save();

        // ── 1. Main fill ──────────────────────────────────────────────────────
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle   = baseColor;
        ctx.fillRect(x1, topClipped, w, h);

        // ── 2. Left accent stripe (always solid, full opacity) ────────────────
        ctx.globalAlpha = borderAlpha;
        ctx.fillStyle   = baseColor;
        ctx.fillRect(x1, topClipped, stripeW, h);

        // ── 3. Top border line ────────────────────────────────────────────────
        ctx.globalAlpha = borderAlpha;
        ctx.strokeStyle = baseColor;
        ctx.lineWidth   = borderW;
        ctx.setLineDash(lineDash);
        ctx.beginPath();
        ctx.moveTo(x1, topClipped + 0.5);
        ctx.lineTo(x2, topClipped + 0.5);
        ctx.stroke();

        // ── 4. Bottom border line ─────────────────────────────────────────────
        ctx.beginPath();
        ctx.moveTo(x1, bottomClipped - 0.5);
        ctx.lineTo(x2, bottomClipped - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── 5. Midpoint line (50% OEP — Optimal Entry Point) ─────────────────
        const midY = Math.round((topClipped + bottomClipped) / 2);
        ctx.globalAlpha = isFresh ? 0.60 : 0.40;
        ctx.strokeStyle = baseColor;
        ctx.lineWidth   = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x1 + stripeW, midY);
        ctx.lineTo(x2, midY);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── 6. Label badge — large, always visible ────────────────────────────
        if (z.label) {
          const baseLabel = z.label.replace(/\s*[✓~✗]$/, '').trim();
          const tag       = isFresh ? 'FRESH' : isTested ? 'TESTED' : 'BROKEN';
          const fullLabel = `${baseLabel} · ${tag}`;
          const fontSize  = isFresh ? 12 : 11;
          ctx.font        = `${isFresh ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;

          const tw   = ctx.measureText(fullLabel).width;
          const bh   = isFresh ? 20 : 18;
          const bpad = 10;
          const bw   = tw + bpad * 2;
          // Clamp badge vertically within visible zone
          const by   = Math.max(topClipped + 2, Math.min(bottomClipped - bh - 2,
            Math.round(topClipped + (h - bh) / 2)));
          const bx   = x1 + stripeW + 4;

          // Badge background
          ctx.globalAlpha = isFresh ? 0.92 : isTested ? 0.82 : 0.68;
          ctx.fillStyle   = isBroken ? '#1e293b' : baseColor;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 5);
          else ctx.rect(bx, by, bw, bh);
          ctx.fill();

          // Badge border
          ctx.globalAlpha = 1;
          ctx.strokeStyle = baseColor;
          ctx.lineWidth   = isFresh ? 1.5 : 1;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 5);
          else ctx.rect(bx, by, bw, bh);
          ctx.stroke();

          // Badge text
          ctx.fillStyle    = '#ffffff';
          ctx.textBaseline = 'middle';
          ctx.fillText(fullLabel, bx + bpad, by + bh / 2);
          ctx.textBaseline = 'alphabetic';

          // ── 7. Right-edge price-axis pin ──────────────────────────────────
          const pinLabel = baseLabel;
          ctx.font       = 'bold 11px system-ui, sans-serif';
          const ptw  = ctx.measureText(pinLabel).width;
          const ph   = 18, ppad = 6;
          const pw   = ptw + ppad * 2;
          const px   = W - pw - 70;
          const py   = midY - ph / 2;

          if (px > bx + bw + 12) {
            ctx.globalAlpha = isFresh ? 0.95 : isTested ? 0.80 : 0.62;
            ctx.fillStyle   = isBroken ? '#1e293b' : baseColor;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 4);
            else ctx.rect(px, py, pw, ph);
            ctx.fill();

            ctx.globalAlpha = 1;
            ctx.strokeStyle = baseColor;
            ctx.lineWidth   = isFresh ? 1.5 : 1;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 4);
            else ctx.rect(px, py, pw, ph);
            ctx.stroke();

            ctx.fillStyle    = '#ffffff';
            ctx.textBaseline = 'middle';
            ctx.fillText(pinLabel, px + ppad, midY);
            ctx.textBaseline = 'alphabetic';
          }
        }

        ctx.restore();
      }
    });
  }
}

class ZonePaneView {
  constructor(getState) {
    this._renderer = new ZoneRenderer(getState);
  }
  renderer() { return this._renderer; }
}

class ZonePlugin {
  constructor() {
    this._state          = { chart: null, series: null, zones: [] };
    this._paneView       = new ZonePaneView(() => this._state);
    this._requestUpdate  = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._state.chart  = chart;
    this._state.series = series;
    this._requestUpdate = requestUpdate || null;
  }
  detached() {
    this._state.chart  = null;
    this._state.series = null;
    this._requestUpdate = null;
  }
  updateAllViews() {}
  paneViews() { return [this._paneView]; }
  setZones(zones) {
    this._state.zones = zones;
    if (this._requestUpdate) this._requestUpdate();
  }
}

// ── User Drawing Plugin ────────────────────────────────────────────────────────

class DrawingRenderer {
  constructor(getState) { this._getState = getState; }

  draw(target) {
    const { chart, series, drawings } = this._getState();
    if (!drawings || drawings.length === 0 || !chart || !series) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W         = mediaSize.width;
      const timeScale = chart.timeScale();

      for (const d of drawings) {
        ctx.save();

        if (d.type === 'hline') {
          const y = series.priceToCoordinate(d.price);
          if (y === null) { ctx.restore(); continue; }
          const yr = Math.round(y);
          ctx.strokeStyle = d.color;
          ctx.lineWidth   = 1.5;
          ctx.setLineDash([7, 4]);
          ctx.beginPath(); ctx.moveTo(0, yr); ctx.lineTo(W, yr); ctx.stroke();
          ctx.setLineDash([]);
          // Label badge on right edge
          const lbl = d.price.toFixed(2);
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          const tw = ctx.measureText(lbl).width;
          ctx.globalAlpha = 0.85;
          ctx.fillStyle   = d.color;
          ctx.fillRect(W - tw - 14, yr - 10, tw + 10, 16);
          ctx.globalAlpha = 1;
          ctx.fillStyle   = '#000';
          ctx.fillText(lbl, W - tw - 9, yr + 2);
        }

        else if (d.type === 'trendline') {
          const x1 = timeScale.timeToCoordinate(d.p1.time);
          const x2 = timeScale.timeToCoordinate(d.p2.time);
          const y1 = series.priceToCoordinate(d.p1.price);
          const y2 = series.priceToCoordinate(d.p2.price);
          if (x1 === null || x2 === null || y1 === null || y2 === null) { ctx.restore(); continue; }
          const rx1 = Math.round(x1), rx2 = Math.round(x2);
          const ry1 = Math.round(y1), ry2 = Math.round(y2);
          ctx.strokeStyle = d.color;
          ctx.lineWidth   = 1.8;
          ctx.beginPath(); ctx.moveTo(rx1, ry1); ctx.lineTo(rx2, ry2); ctx.stroke();
          // Faded extension ray
          if (Math.abs(rx2 - rx1) > 2) {
            const slope = (ry2 - ry1) / (rx2 - rx1);
            const extX  = rx2 > rx1 ? W : 0;
            const extY  = ry2 + slope * (extX - rx2);
            ctx.globalAlpha = 0.30;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(rx2, ry2); ctx.lineTo(extX, extY); ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
        }

        else if (d.type === 'rect') {
          const x1 = timeScale.timeToCoordinate(d.p1.time);
          const x2 = timeScale.timeToCoordinate(d.p2.time);
          const y1 = series.priceToCoordinate(d.p1.price);
          const y2 = series.priceToCoordinate(d.p2.price);
          if (x1 === null || x2 === null || y1 === null || y2 === null) { ctx.restore(); continue; }
          const left   = Math.round(Math.min(x1, x2));
          const right  = Math.round(Math.max(x1, x2));
          const top    = Math.round(Math.min(y1, y2));
          const bottom = Math.round(Math.max(y1, y2));
          ctx.globalAlpha = 0.10;
          ctx.fillStyle   = d.color;
          ctx.fillRect(left, top, right - left, bottom - top);
          ctx.globalAlpha = 0.80;
          ctx.strokeStyle = d.color;
          ctx.lineWidth   = 1.2;
          ctx.strokeRect(left, top, right - left, bottom - top);
          ctx.globalAlpha = 1;
        }

        ctx.restore();
      }
    });
  }
}

class DrawingPaneView {
  constructor(gs) { this._r = new DrawingRenderer(gs); }
  renderer() { return this._r; }
}

class DrawingPlugin {
  constructor() {
    this._state         = { chart: null, series: null, drawings: [] };
    this._paneView      = new DrawingPaneView(() => this._state);
    this._requestUpdate = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._state.chart  = chart;
    this._state.series = series;
    this._requestUpdate = requestUpdate || null;
  }
  detached() {
    this._state.chart  = null;
    this._state.series = null;
    this._requestUpdate = null;
  }
  updateAllViews() {}
  paneViews() { return [this._paneView]; }
  setDrawings(d) {
    this._state.drawings = d;
    if (this._requestUpdate) this._requestUpdate();
  }
}

// ── Drawing persistence helpers ────────────────────────────────────────────────
function drawKey(symId, tf) { return `st_draw_${symId}_${tf}`; }
function loadDrawings(symId, tf) { return lsGet(drawKey(symId, tf), []); }
function saveDrawings(symId, tf, d) { lsSet(drawKey(symId, tf), d); }

// ── IFVG Detection ────────────────────────────────────────────────────────────
// An FVG that has been fully mitigated (price closed through the gap) now
// acts as support/resistance in the opposite direction — Inverted FVG.
//   Bullish FVG mitigated → bearish IFVG (old support becomes resistance)
//   Bearish FVG mitigated → bullish IFVG (old resistance becomes support)

function detectIFVGs(fvgs, candles) {
  if (!fvgs || fvgs.length === 0 || !candles || candles.length === 0) return [];
  const results = [];

  for (const fvg of fvgs) {
    const fvgIdx = candles.findIndex((c) => c.time >= fvg.time);
    if (fvgIdx < 0) continue;
    const after = candles.slice(fvgIdx + 1);

    let mitigated = false;
    let mitigationTime = null;

    if (fvg.type === 'bullish') {
      // Bullish FVG (gap up): fully mitigated when a close drops below the gap bottom
      for (const c of after) {
        if (c.close < fvg.bottom) { mitigated = true; mitigationTime = c.time; break; }
      }
      if (mitigated) results.push({ ...fvg, ifvgType: 'bearish', mitigationTime });
    } else {
      // Bearish FVG (gap down): fully mitigated when a close rises above the gap top
      for (const c of after) {
        if (c.close > fvg.top) { mitigated = true; mitigationTime = c.time; break; }
      }
      if (mitigated) results.push({ ...fvg, ifvgType: 'bullish', mitigationTime });
    }
  }

  return results;
}

// ── Build zone objects from ICT analysis ──────────────────────────────────────

function buildZones(analysis, candles, toggles) {
  if (!analysis || !candles || candles.length < 2) return [];

  const zones    = [];
  const { swingHigh, swingLow, equil } = analysis;
  const range    = (swingHigh || 0) - (swingLow || 0);
  const startIdx = Math.max(0, candles.length - 80);
  const pdStart  = candles[startIdx]?.time;
  
  // Define ATR for zone heights
  const lastC = candles.slice(-15);
  const atr = lastC.length > 1 ? lastC.reduce((acc, c, i) => i === 0 ? acc : acc + Math.max(c.high - c.low, Math.abs(c.high - lastC[i-1].close)), 0) / (lastC.length - 1) : range * 0.05;

  // ── Demand zones (Bullish Order Blocks) ──────────────────────────────────────
  if (toggles.demand) {
    (analysis.orderBlocks || [])
      .filter((ob) => ob.type === 'bullish')
      .filter((ob) => toggles.freshOnly ? !ob.mitigated : true)
      .forEach((ob) => {
        const baseLabel = ob.isBreaker ? '+Breaker' : 'Demand';
        const strLabel  = ob.strength ? ` (S:${Math.round(ob.strength)})` : '';
        zones.push({
          startTime:  ob.time,
          endTime:    null,
          top:        ob.top,
          bottom:     ob.bottom,
          color:      '#22c55e', // green — renderer overrides to grey when broken
          label:      baseLabel + strLabel,
          mitigation: ob.mitigation || 'fresh',
        });
      });
  }

  // ── Supply zones (Bearish Order Blocks) ──────────────────────────────────────
  if (toggles.supply) {
    (analysis.orderBlocks || [])
      .filter((ob) => ob.type === 'bearish')
      .filter((ob) => toggles.freshOnly ? !ob.mitigated : true)
      .forEach((ob) => {
        const baseLabel = ob.isBreaker ? '-Breaker' : 'Supply';
        const strLabel  = ob.strength ? ` (S:${Math.round(ob.strength)})` : '';
        zones.push({
          startTime:  ob.time,
          endTime:    null,
          top:        ob.top,
          bottom:     ob.bottom,
          color:      '#ef4444', // red — renderer overrides to grey when broken
          label:      baseLabel + strLabel,
          mitigation: ob.mitigation || 'fresh',
        });
      });
  }

  // ── Macro S/R Zones (Pivot-based Clustering — LuxAlgo Style) ──────────
  if (toggles.srZones) {
    const detector = new AdvancedSRDetector(15, 15, 0.005);
    const srZones  = detector.analyze(candles.slice(-300)); // last 300 bars
    
    srZones.forEach((z) => {
      // Zone height based on ATR (from Line 465)
      const hScale = Math.max(atr * 0.15, z.price * 0.001); 
      const isRes  = z.initialType === 'RES';
      const color  = isRes ? '#f43f5e' : '#10b981'; // vibrant rose/emerald
      
      zones.push({
        startTime:  z.startTime,
        endTime:    null,
        top:        z.price + hScale,
        bottom:     z.price - hScale,
        color:      color,
        label:      `${isRes ? 'Res' : 'Sup'} (T:${z.touches}${z.isFlip ? ', Flip' : ''})`,
        mitigation: 'tested',
      });
    });
  }

  // ── FVG zones ─────────────────────────────────────────────────────────────────
  if (toggles.fvg) {
    (analysis.fvgs || []).forEach((fvg) => {
      zones.push({
        startTime:  fvg.time,
        endTime:    null,
        top:        fvg.top,
        bottom:     fvg.bottom,
        color:      fvg.type === 'bullish' ? '#38bdf8' : '#f472b6',
        label:      fvg.type === 'bullish' ? 'Bull FVG' : 'Bear FVG',
        mitigation: 'fresh', // FVGs always show as fresh (no mitigation tracking yet)
      });
    });
  }

  // ── IFVG zones (Inverted FVG — mitigated FVGs acting as S/R in opposite direction) ──
  if (toggles.ifvg) {
    const ifvgs = detectIFVGs(analysis.fvgs || [], candles);
    ifvgs.forEach((ifvg) => {
      // Bearish IFVG = was bullish FVG, now resistance → warm purple/violet
      // Bullish IFVG = was bearish FVG, now support   → teal
      const isBearish = ifvg.ifvgType === 'bearish';
      zones.push({
        startTime:  ifvg.mitigationTime || ifvg.time,
        endTime:    null,
        top:        ifvg.top,
        bottom:     ifvg.bottom,
        color:      isBearish ? '#c084fc' : '#2dd4bf',
        label:      isBearish ? 'IFVG Bear' : 'IFVG Bull',
        mitigation: 'tested', // IFVGs render with dashed border to distinguish from fresh FVGs
      });
    });
  }

  // ── Premium / Discount / Equilibrium matrix ───────────────────────────────────
  if (toggles.pd && swingHigh && swingLow && range > 0 && pdStart) {
    zones.push({
      startTime: pdStart, endTime: null,
      top:    swingHigh,
      bottom: swingHigh - range * 0.35,
      color:  '#ef4444', label: 'Premium',   mitigation: 'tested',
    });
    zones.push({
      startTime: pdStart, endTime: null,
      top:    swingLow + range * 0.35,
      bottom: swingLow,
      color:  '#22c55e', label: 'Discount',  mitigation: 'tested',
    });
    if (equil) {
      zones.push({
        startTime: pdStart, endTime: null,
        top:    equil + range * 0.04,
        bottom: equil - range * 0.04,
        color:  '#a855f7', label: 'EQ',      mitigation: 'tested',
      });
    }
  }

  return zones;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Chart({ sym, tf, onTFChange, candles, analysis, theme }) {
  const containerRef    = useRef(null);
  const chartRef        = useRef(null);
  const seriesRef       = useRef(null);
  const pluginRef       = useRef(null);
  const linesRef        = useRef([]);
  const drawPluginRef   = useRef(null);
  const pendingPointRef = useRef(null);
  const drawModeRef     = useRef(null);
  const drawColorRef    = useRef('#e2b340');
  const drawingsRef     = useRef([]);
  const initialFitRef   = useRef(false);
  const candlesRef      = useRef([]);  // kept in sync for stale-closure-free volume lookup

  const [lwLoaded,    setLwLoaded]    = useState(!!window.LightweightCharts);
  const [height,      setHeight]      = useState(420);
  const [fullscreen,  setFullscreen]  = useState(false);
  const [chartReady,  setChartReady]  = useState(0); // increments each time chart is rebuilt
  const [toggles,     setToggles]     = useState({
    demand: false, supply: false, fvg: false, ifvg: false,
    srZones: false, autoTL: false,
    pd: false, liq: false, bos: false,
    analysis: false, freshOnly: false,
  });
  const autoTLRef = useRef([]); // auto-generated trendlines kept in ref
  const [error,       setError]       = useState(null);
  const [candleCount, setCandleCount] = useState(0);
  const [drawMode,    setDrawMode]    = useState(null); // null|'hline'|'trendline'|'rect'
  const [drawColor,   setDrawColor]   = useState('#e2b340');
  const [drawings,    setDrawings]    = useState(() => loadDrawings(sym.id, tf));
  const [pendingPt,   setPendingPt]   = useState(null); // for UI hint only
  const [timezone,    setTimezone]    = useState(() => lsGet(TZ_LS_KEY, 'Asia/Kolkata'));
  const [hoverCandle, setHoverCandle] = useState(null); // OHLCV data under cursor

  // ── Step 1: Load LW Charts library ──
  useEffect(() => {
    if (lwLoaded) return;
    loadLWCharts()
      .then(() => setLwLoaded(true))
      .catch((e) => setError('Chart library failed to load: ' + e.message));
  }, [lwLoaded]);

  // ── Step 2: Create chart + series + zone primitive ──
  useEffect(() => {
    if (!lwLoaded || !containerRef.current) return;

    const LW     = window.LightweightCharts;
    const colors = getChartColors(theme);

    const chart = LW.createChart(containerRef.current, {
      autoSize: true,
      height:   fullscreen ? window.innerHeight - 185 : height,
      layout: {
        background: { type: 'solid', color: colors.bg },
        textColor:  colors.text,
        fontSize:   12,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair:       { mode: LW.CrosshairMode ? LW.CrosshairMode.Normal : 1 },
      rightPriceScale: { borderColor: colors.border },
      timeScale:       { borderColor: colors.border, timeVisible: true, secondsVisible: false },
    });

    const series = chart.addCandlestickSeries({
      upColor:         '#22c55e',
      downColor:       '#ef4444',
      borderUpColor:   '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor:     '#22c55e',
      wickDownColor:   '#ef4444',
    });

    // Attach zone primitive (LW Charts v4+ API)
    const plugin = new ZonePlugin();
    if (typeof series.attachPrimitive === 'function') {
      series.attachPrimitive(plugin);
      pluginRef.current = plugin;
    } else {
      pluginRef.current = null;
    }

    // Attach drawing primitive
    const drawPlugin = new DrawingPlugin();
    if (typeof series.attachPrimitive === 'function') {
      series.attachPrimitive(drawPlugin);
      drawPluginRef.current = drawPlugin;
    }

    chartRef.current  = chart;
    seriesRef.current = series;
    // Signal that a fresh chart is ready — Step 3 will reload candle data
    setChartReady((n) => n + 1);

    return () => {
      linesRef.current   = [];
      pluginRef.current  = null;
      drawPluginRef.current = null;
      initialFitRef.current = false;
      try { chart.remove(); } catch {}
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, [lwLoaded, fullscreen, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 3: Handle Theme Update — Re-paint chart when light/dark mode toggles ──
  useEffect(() => {
    if (!chartRef.current) return;
    const c = getChartColors(theme);
    try {
      chartRef.current.applyOptions({
        layout: { background: { type: 'solid', color: c.bg }, textColor: c.text },
        grid:   { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.border },
        timeScale:       { borderColor: c.border },
      });
    } catch (e) {
      console.warn('Theme apply error:', e);
    }
  }, [theme]);

  // ── Step 4: Set candle data — runs whenever candles update OR chart is rebuilt ──
  useEffect(() => {
    if (!seriesRef.current || !candles || candles.length === 0) return;
    try {
      seriesRef.current.setData(candles);
      candlesRef.current = candles; // keep ref in sync for OHLCV volume lookup
      // Preserve user's zoom/scroll on subsequent refreshes
      if (!initialFitRef.current) {
        chartRef.current?.timeScale().fitContent();
        initialFitRef.current = true;
      }
      setCandleCount(candles.length);
    } catch (e) {
      console.error('Chart setData error:', e);
    }
  }, [candles, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 4: Draw all ICT overlays (zones + markers + price lines) ──
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;

    // Clear old price lines
    linesRef.current.forEach((ln) => { try { seriesRef.current.removePriceLine(ln); } catch {} });
    linesRef.current = [];

    const addLine = (price, color, title, style = 0, width = 1) => {
      if (!price || isNaN(price)) return;
      try {
        const ln = seriesRef.current.createPriceLine({
          price, color, title, lineWidth: width, lineStyle: style, axisLabelVisible: true,
        });
        linesRef.current.push(ln);
      } catch {}
    };

    // Entry / SL / TP price lines — only when "Entry/SL/TP" toggle is ON
    if (toggles.analysis && analysis) {
      if (analysis.entry) addLine(analysis.entry, '#e2b340', 'Entry', 0, 2);
      if (analysis.sl)    addLine(analysis.sl,    '#ef4444', 'SL',    2, 1);
      if (analysis.tp1)   addLine(analysis.tp1,   '#22c55e', 'TP1',   2, 1);
      if (analysis.tp2)   addLine(analysis.tp2,   '#22c55e', 'TP2',   2, 1);
    }

    // Liquidity: Pools (BSL / SSL)
    if (toggles.liq && analysis) {
      if (analysis.pools && analysis.pools.length > 0) {
        analysis.pools.forEach((p) => {
          const isMajor = p.strength === 'major';
          const title   = isMajor ? `Major ${p.type}` : p.type;
          const width   = isMajor ? 2 : 1;
          const style   = isMajor ? 0 : 2; // 0=Solid, 2=Dashed
          addLine(p.price, '#f97316', title, style, width);
        });
      } else {
        (analysis.bsl || []).forEach((b) => addLine(b.price, '#f97316', 'BSL', 2, 1));
        (analysis.ssl || []).forEach((s) => addLine(s.price, '#f97316', 'SSL', 2, 1));
      }
    }

    // BOS / CHOCH markers
    if (toggles.bos && candles && candles.length >= 25) {
      const events  = detectBOSCHOCH(candles);
      const markers = events
        .map((e) => ({ time: e.time, position: e.position, color: e.color, shape: e.shape, text: e.label }))
        .sort((a, b) => a.time - b.time); // LW Charts requires sorted markers
      try { seriesRef.current.setMarkers(markers); } catch {}
    } else {
      try { seriesRef.current.setMarkers([]); } catch {}
    }

    // Zone rectangles via primitive
    if (pluginRef.current && analysis) {
      const zones = buildZones(analysis, candles, toggles);
      pluginRef.current.setZones(zones); // requestUpdate() is called inside setZones
    } else if (analysis) {
      // Fallback: price lines when primitive API is unavailable
      if (toggles.demand || toggles.supply) {
        (analysis.orderBlocks || []).forEach((ob) => {
          const c = ob.type === 'bullish' ? '#22c55e' : '#ef4444';
          const show = (ob.type === 'bullish' && toggles.demand) || (ob.type === 'bearish' && toggles.supply);
          if (!show) return;
          addLine(ob.top,    c,        ob.type === 'bullish' ? 'Demand' : 'Supply', 2, 1);
          addLine(ob.bottom, c,        'OB Bot', 2, 1);
          addLine(ob.mid,    c + '99', 'OB Mid', 1, 1);
        });
      }
      if (toggles.fvg) {
        (analysis.fvgs || []).forEach((fvg) => {
          const c = fvg.type === 'bullish' ? '#3b82f6' : '#a855f7';
          addLine(fvg.top,    c, fvg.type === 'bullish' ? 'Bull FVG' : 'Bear FVG', 2, 1);
          addLine(fvg.bottom, c, 'FVG Bot', 2, 1);
        });
      }
      if (toggles.ifvg && candles && candles.length > 0) {
        detectIFVGs(analysis.fvgs || [], candles).forEach((ifvg) => {
          const c = ifvg.ifvgType === 'bearish' ? '#c084fc' : '#2dd4bf';
          addLine(ifvg.top,    c, ifvg.ifvgType === 'bearish' ? 'IFVG Bear' : 'IFVG Bull', 2, 1);
          addLine(ifvg.bottom, c, 'IFVG Bot', 2, 1);
        });
      }
      if (toggles.pd && analysis.equil) {
        addLine(analysis.equil,     '#a855f7',   'EQ',       0, 2);
        addLine(analysis.swingHigh, '#ef444499', 'Premium',  2, 1);
        addLine(analysis.swingLow,  '#22c55e99', 'Discount', 2, 1);
      }
      if (toggles.srZones) {
        (analysis.macroHighs || []).forEach((h) => {
          addLine(h.price, '#ef4444', 'Macro RES', 1, 1);
        });
        (analysis.macroLows || []).forEach((l) => {
          addLine(l.price, '#22c55e', 'Macro SUP', 1, 1);
        });
      }
    }
  }, [analysis, candles, toggles, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 5: Apply timezone to chart time axis ──
  useEffect(() => {
    if (!chartRef.current) return;
    const { timeFormatter, tickMarkFormatter } = makeTimeFormatters(timezone);
    chartRef.current.applyOptions({
      localization: { timeFormatter },
      timeScale:    { tickMarkFormatter },
    });
    lsSet(TZ_LS_KEY, timezone);
  }, [timezone, lwLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 6: Sync draw state into refs (avoids stale closures in click handler) ──
  useEffect(() => { drawModeRef.current  = drawMode;  }, [drawMode]);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { drawingsRef.current  = drawings;  }, [drawings]);

  // ── Step 6: Reset + reload drawings when sym or tf changes ──
  useEffect(() => {
    initialFitRef.current = false;
    pendingPointRef.current = null;
    setPendingPt(null);
    const saved = loadDrawings(sym.id, tf);
    setDrawings(saved);
    drawingsRef.current = saved;
  }, [sym.id, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 7: Subscribe chart click for drawing tools ──
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;

    const handler = (param) => {
      const mode = drawModeRef.current;
      if (!mode || !param.time || !seriesRef.current) return;
      const price = seriesRef.current.coordinateToPrice(param.point?.y ?? 0);
      if (price === null || price === undefined) return;
      const color = drawColorRef.current;

      if (mode === 'hline') {
        const newD   = { id: Date.now(), type: 'hline', price, color };
        const updated = [...drawingsRef.current, newD];
        drawingsRef.current = updated;
        setDrawings(updated);
        saveDrawings(sym.id, tf, updated);
      } else if (mode === 'trendline' || mode === 'rect') {
        if (!pendingPointRef.current) {
          pendingPointRef.current = { time: param.time, price };
          setPendingPt({ time: param.time, price });
        } else {
          const p1  = pendingPointRef.current;
          pendingPointRef.current = null;
          setPendingPt(null);
          const newD   = { id: Date.now(), type: mode, p1, p2: { time: param.time, price }, color };
          const updated = [...drawingsRef.current, newD];
          drawingsRef.current = updated;
          setDrawings(updated);
          saveDrawings(sym.id, tf, updated);
        }
      }
    };

    chartRef.current.subscribeClick(handler);
    return () => { try { chartRef.current?.unsubscribeClick(handler); } catch {} };
  }, [lwLoaded, sym.id, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 8: Push drawings to plugin — merges user drawings + auto trendlines ──
  useEffect(() => {
    if (!drawPluginRef.current) return;
    drawPluginRef.current.setDrawings([...drawings, ...autoTLRef.current]);
  }, [drawings]);

  // ── Step 8b: Recompute auto trendlines via engine data ──────────
  useEffect(() => {
    if (toggles.autoTL && analysis && analysis.trendlines) {
      autoTLRef.current = analysis.trendlines.map(t => ({
        id: t.id,
        type: 'trendline',
        p1: { time: t.p1.time, price: t.p1.y },
        p2: { time: t.p2.time, price: t.p2.y },
        color: t.color
      }));
    } else {
      autoTLRef.current = [];
    }
    if (drawPluginRef.current) {
      drawPluginRef.current.setDrawings([...drawingsRef.current, ...autoTLRef.current]);
    }
  }, [toggles.autoTL, analysis, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 9: Crosshair → show candle OHLCV tooltip ──
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    const handler = (param) => {
      if (!param.time || !param.seriesData) {
        setHoverCandle(null);
        return;
      }
      const bar = param.seriesData.get(seriesRef.current);
      if (bar) {
        // LW Charts candlestick series only returns {open,high,low,close} — no volume.
        // Look it up from the candles array via ref to avoid stale closure.
        const raw = candlesRef.current.find((c) => c.time === param.time);
        setHoverCandle({ time: param.time, ...bar, volume: raw?.volume ?? 0 });
      } else {
        setHoverCandle(null);
      }
    };
    chartRef.current.subscribeCrosshairMove(handler);
    return () => { try { chartRef.current?.unsubscribeCrosshairMove(handler); } catch {} };
  }, [lwLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleZone = (key) => setToggles((p) => ({ ...p, [key]: !p[key] }));

  const tfStyle = (active) => ({
    padding: '5px 14px', fontSize: 12, fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    borderRadius: 6, cursor: 'pointer', transition: 'all 0.12s',
    border:     active ? '2px solid #e2b340' : '2px solid var(--s3)',
    background: active ? '#e2b340'           : 'var(--s2)',
    color:      active ? '#000'              : 'var(--t1)',
    boxShadow:  active ? '0 0 10px #e2b34055' : 'none',
  });

  const zoneStyle = (active, color) => ({
    padding: '4px 12px', fontSize: 11, fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    borderRadius: 5, cursor: 'pointer', transition: 'all 0.12s',
    border:     active ? `1.5px solid ${color}` : '1.5px solid var(--s3)',
    background: active ? `${color}28`           : 'var(--s2)',
    color:      active ? color                  : 'var(--t2)',
    boxShadow:  active ? `0 0 6px ${color}44`  : 'none',
  });

  if (error) return (
    <div className="card" style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ color: 'var(--bear)', marginBottom: 8 }}>⚠ {error}</div>
      <button className="btn btn-ghost btn-sm"
        onClick={() => { lwPromise = null; setError(null); setLwLoaded(false); }}>
        Retry
      </button>
    </div>
  );

  return (
    <div
      className="card"
      style={{
        padding: 0, overflow: 'hidden', position: 'relative',
        ...(fullscreen ? { position: 'fixed', inset: 0, zIndex: 999, borderRadius: 0 } : {}),
      }}
    >
      {/* ── Row 1: Timeframe buttons + height controls ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '10px 14px 6px', borderBottom: '1px solid var(--s3)', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIMEFRAMES.map((t) => (
            <button key={t.value} onClick={() => onTFChange(t)} style={tfStyle(tf === t.value)}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {candleCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>
            {candleCount} bars
          </span>
        )}
        {analysis && analysis.score > 0 && (
          <span style={{
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700, padding: '2px 8px',
            borderRadius: 4,
            background: analysis.score >= 70 ? '#22c55e22' : analysis.score >= 45 ? '#e2b34022' : '#ef444422',
            color: analysis.score >= 70 ? '#22c55e' : analysis.score >= 45 ? '#e2b340' : '#ef4444',
          }}>
            {analysis.score} · {analysis.bias}
          </span>
        )}
        {/* Timezone selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'monospace' }}>TZ:</span>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            title="Chart timezone"
            style={{
              background: 'var(--s2)', border: '1px solid var(--s3)',
              color: 'var(--t1)', borderRadius: 4, padding: '3px 6px',
              fontSize: 11, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
              outline: 'none',
            }}
          >
            {TIMEZONES.map((z) => (
              <option key={z.tz} value={z.tz}>{z.label} ({z.offset})</option>
            ))}
          </select>
        </div>

        <button className="btn-icon" onClick={() => setHeight((h) => Math.max(280, h - 80))} title="Shorter">−</button>
        <button className="btn-icon" onClick={() => setHeight((h) => Math.min(900, h + 80))} title="Taller">+</button>
        <button className="btn-icon" onClick={() => setFullscreen((f) => !f)} title="Fullscreen">
          {fullscreen ? '⊡' : '⊞'}
        </button>
      </div>

      {/* ── Row 2: Zone toggle buttons ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 14px 8px', borderBottom: '1px solid var(--s3)', flexWrap: 'wrap',
      }}>
        {/* Master Draw All / Clear All */}
        <button
          title="Draw all ICT zones on chart"
          onClick={() => setToggles((p) => ({ ...p, demand: true, supply: true, fvg: true, ifvg: true, srZones: true, autoTL: true, pd: true, liq: true, bos: true, analysis: true }))}
          style={{
            padding: '4px 11px', fontSize: 11, fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace', borderRadius: 5, cursor: 'pointer',
            border: '1.5px solid #e2b340', background: '#e2b34022', color: '#e2b340',
          }}
        >
          ◈ Draw All
        </button>
        <button
          title="Hide all ICT zones"
          onClick={() => setToggles((p) => ({ ...p, demand: false, supply: false, fvg: false, ifvg: false, srZones: false, autoTL: false, pd: false, liq: false, bos: false, analysis: false }))}
          style={{
            padding: '4px 11px', fontSize: 11, fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace', borderRadius: 5, cursor: 'pointer',
            border: '1.5px solid var(--s3)', background: 'var(--s2)', color: 'var(--t2)',
          }}
        >
          ✕ Clear All
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--s3)', margin: '0 2px' }} />

        {/* Individual toggles — show zone count as badge */}
        {ZONE_BUTTONS.map(({ key, label, color }) => {
          // Count how many zones this button would show
          let count = 0;
          if (analysis) {
            if (key === 'demand')   count = (analysis.orderBlocks || []).filter((o) => o.type === 'bullish').length;
            else if (key === 'supply')   count = (analysis.orderBlocks || []).filter((o) => o.type === 'bearish').length;
            else if (key === 'fvg')      count = (analysis.fvgs || []).length;
            else if (key === 'ifvg')     count = detectIFVGs(analysis.fvgs || [], candles || []).length;
            else if (key === 'srZones')  count = (analysis.macroHighs || []).length + (analysis.macroLows || []).length;
            else if (key === 'autoTL')   count = (analysis.trendlines || []).length;
            else if (key === 'bos')      count = (analysis.bos || []).length + (analysis.choch || []).length;
            else if (key === 'pd')       count = analysis.swingHigh && analysis.swingLow ? 3 : 0;
            else if (key === 'liq')      count = ((analysis.bsl || []).length + (analysis.ssl || []).length);
            else if (key === 'analysis') count = [analysis.entry, analysis.sl, analysis.tp1, analysis.tp2].filter(Boolean).length;
          }
          return (
            <button key={key} onClick={() => toggleZone(key)} style={zoneStyle(toggles[key], color)}>
              {label}
              {count > 0 && (
                <span style={{
                  marginLeft: 4, fontSize: 10, fontWeight: 800,
                  background: toggles[key] ? 'rgba(0,0,0,0.25)' : `${color}33`,
                  borderRadius: 3, padding: '0 4px',
                  color: toggles[key] ? '#fff' : color,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <div style={{ width: 1, height: 16, background: 'var(--s3)', margin: '0 2px' }} />

        {/* Fresh Only filter */}
        <button
          onClick={() => toggleZone('freshOnly')}
          title="Show only unmitigated (fresh) demand/supply zones"
          style={zoneStyle(toggles.freshOnly, '#e2b340')}
        >
          Fresh Only
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--s3)', margin: '0 8px' }} />

        <div style={{ flex: 1 }} />


        {/* Mitigation legend */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {[
            { label: 'FRESH',  bg: '#22c55e',   text: '#fff' },
            { label: 'TESTED', bg: '#22c55e66', text: '#22c55e' },
            { label: 'BROKEN', bg: '#33415566', text: '#94a3b8' },
          ].map(({ label, bg, text }) => (
            <span key={label} style={{
              fontSize: 10, fontFamily: 'monospace',
              padding: '2px 8px', borderRadius: 4,
              background: bg, color: text, fontWeight: 700,
            }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Row 3: Drawing tools ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 14px 7px', borderBottom: '1px solid var(--s3)', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 2, fontFamily: 'monospace', fontWeight: 600 }}>DRAW:</span>
        {[
          { key: 'hline',     label: '─ H-Line', title: 'Horizontal line — click once on chart' },
          { key: 'trendline', label: '╱ Trend',  title: 'Trend line — click 2 points' },
          { key: 'rect',      label: '▭ Box',    title: 'Rectangle — click 2 corner points' },
        ].map(({ key, label, title }) => (
          <button
            key={key}
            title={title}
            onClick={() => {
              const next = drawMode === key ? null : key;
              setDrawMode(next);
              pendingPointRef.current = null;
              setPendingPt(null);
            }}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 700,
              fontFamily: 'JetBrains Mono, monospace', borderRadius: 5, cursor: 'pointer',
              border:     `1.5px solid ${drawMode === key ? drawColor : 'var(--s3)'}`,
              background: drawMode === key ? `${drawColor}28`            : 'var(--s2)',
              color:      drawMode === key ? drawColor                   : 'var(--t2)',
              boxShadow:  drawMode === key ? `0 0 6px ${drawColor}55`   : 'none',
            }}
          >
            {label}
          </button>
        ))}

        <div style={{ width: 1, height: 16, background: 'var(--s3)', margin: '0 3px' }} />

        {/* Colour swatches */}
        {['#e2b340', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316', '#ffffff'].map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => setDrawColor(c)}
            style={{
              width: 16, height: 16, borderRadius: '50%', padding: 0,
              background: c, cursor: 'pointer',
              border: `2px solid ${drawColor === c ? '#fff' : 'transparent'}`,
              boxShadow: drawColor === c ? `0 0 5px ${c}` : 'none',
              outline: 'none',
            }}
          />
        ))}

        <div style={{ flex: 1 }} />

        {/* Status hint when drawing mode active */}
        {drawMode && (
          <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace', marginRight: 6 }}>
            {drawMode === 'hline'
              ? '↗ Click chart to place'
              : pendingPt
                ? '↗ Click 2nd point…'
                : '↗ Click 1st point…'}
          </span>
        )}

        <button
          title="Undo last drawing"
          onClick={() => {
            const u = drawings.slice(0, -1);
            setDrawings(u);
            saveDrawings(sym.id, tf, u);
          }}
          disabled={drawings.length === 0}
          style={{
            padding: '3px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
            background: 'var(--s2)', border: '1px solid var(--s3)',
            color: drawings.length === 0 ? 'var(--t3)' : 'var(--t2)',
          }}
        >
          ↩ Undo
        </button>
        <button
          title="Clear all drawings on this chart"
          onClick={() => { setDrawings([]); drawingsRef.current = []; saveDrawings(sym.id, tf, []); }}
          disabled={drawings.length === 0}
          style={{
            padding: '3px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
            background: drawings.length > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${drawings.length > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
            color: drawings.length > 0 ? '#ef4444' : '#3a4a5a',
          }}
        >
          🗑 Clear
        </button>
      </div>

      {/* ── Chart area ── */}
      {!lwLoaded ? (
        <div style={{
          height, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#4a5a6a', gap: 8,
        }}>
          <span style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>⟳</span>
          Loading chart library…
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* OHLCV tooltip bar — shown when crosshair is on a candle */}
          {hoverCandle && (() => {
            const isUp   = hoverCandle.close >= hoverCandle.open;
            const chg    = hoverCandle.close - hoverCandle.open;
            const chgPct = (chg / hoverCandle.open) * 100;
            return (
              <div style={{
                position: 'absolute', top: 6, left: 10, zIndex: 10,
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 14px', borderRadius: 7,
                background: 'var(--s1)',
                border: '1.5px solid var(--s3)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.18)',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12, pointerEvents: 'none',
              }}>
                {/* Date/time */}
                <span style={{ color: 'var(--t3)', fontSize: 11, marginRight: 2 }}>
                  {new Date(hoverCandle.time * 1000).toLocaleString('en-IN', {
                    timeZone: timezone,
                    day: '2-digit', month: 'short',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })}
                </span>
                <span style={{ width: 1, height: 14, background: 'var(--s3)', flexShrink: 0 }} />
                {[
                  { label: 'O', val: hoverCandle.open  },
                  { label: 'H', val: hoverCandle.high  },
                  { label: 'L', val: hoverCandle.low   },
                  { label: 'C', val: hoverCandle.close },
                ].map(({ label, val }) => {
                  const accent = label === 'C'
                    ? (isUp ? '#16a34a' : '#dc2626')
                    : label === 'H' ? '#16a34a'
                    : label === 'L' ? '#dc2626'
                    : 'var(--t2)';
                  return (
                    <span key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                      <span style={{ color: 'var(--t3)', fontSize: 10, fontWeight: 600 }}>{label}</span>
                      <span style={{ color: accent, fontWeight: label === 'C' ? 700 : 500 }}>
                        {val?.toFixed(sym.priceDigits)}
                      </span>
                    </span>
                  );
                })}
                <span style={{ width: 1, height: 14, background: 'var(--s3)', flexShrink: 0 }} />
                {/* Change */}
                <span style={{
                  color: isUp ? '#16a34a' : '#dc2626', fontWeight: 700,
                  background: isUp ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
                  padding: '1px 6px', borderRadius: 4,
                }}>
                  {isUp ? '+' : ''}{chg.toFixed(sym.priceDigits)} ({isUp ? '+' : ''}{chgPct.toFixed(2)}%)
                </span>
                {/* Volume if present */}
                {hoverCandle.volume > 0 && (
                  <span style={{ color: 'var(--t3)', fontSize: 11 }}>
                    V {hoverCandle.volume >= 1000
                      ? (hoverCandle.volume / 1000).toFixed(1) + 'K'
                      : hoverCandle.volume}
                  </span>
                )}
              </div>
            );
          })()}

          <div
            ref={containerRef}
            style={{
              height: fullscreen ? 'calc(100vh - 185px)' : height,
              width: '100%',
              cursor: drawMode ? 'crosshair' : 'default',
            }}
          />
        </div>
      )}

      {/* ── No data overlay ── */}
      {lwLoaded && candles && candles.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, top: 90,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 8, pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 32, opacity: 0.2 }}>📊</div>
          <div style={{ fontSize: 13, color: '#4a5a6a' }}>No chart data</div>
          <div style={{ fontSize: 12, color: '#3a4a5a', textAlign: 'center' }}>
            Worker URL not returning candles.<br />
            Add a free TwelveData API key in Settings as fallback.
          </div>
        </div>
      )}

      {/* ── Symbol Watermark ── */}
      {lwLoaded && candles && candles.length > 0 && (
        <div style={{
          position: 'absolute', top: '55%', left: '50%', transform: 'translate(-50%, -50%)',
          fontSize: '15vh', fontWeight: 900, 
          color: document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,0.04)' : 'var(--s3)', 
          pointerEvents: 'none', zIndex: 1, opacity: 0.25, whiteSpace: 'nowrap',
          userSelect: 'none',
        }}>
          {sym?.id}
        </div>
      )}
    </div>
  );
}
