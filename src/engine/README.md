# Sovereign Trader — Upgraded Engine Files (Phase 4)

## What Changed

These are **drop-in replacements** for `ict-agent/src/engine/`. Copy them over:

```
engine_js/engineConfig.js         → ict-agent/src/engine/engineConfig.js  (NEW)
engine_js/orderBlockDetector.js   → ict-agent/src/engine/orderBlockDetector.js
engine_js/fvgDetector.js          → ict-agent/src/engine/fvgDetector.js
engine_js/liquidityDetector.js    → ict-agent/src/engine/liquidityDetector.js
engine_js/ictAnalysis.js          → ict-agent/src/engine/ictAnalysis.js
```

## Enhancements

### 1. Order Block Strength Scoring (0–100)
- ATR × 1.2 displacement validation
- Volume > SMA(20) × 1.2 validation
- Strength = (displacement_factor × 0.6 + volume_factor × 0.4) × 100
- Breaker Block conversion when OBs are fully mitigated

### 2. FVG ATR Filter
- Gaps must be >= ATR × 0.3 to qualify
- `gapATR` field shows gap size in ATR units

### 3. Liquidity Pool Clustering (EQH/EQL)
- ATR-based tolerance grouping of swing highs/lows
- Pool strength classification (minor: 2 touches, major: 3+)
- New `pools` array in analysis output

### 4. Strength-Weighted Pillar Scoring
- OB pillar points now scale by strength: institutional OBs get full 12, weaker ones proportionally less
- Liquidity Pool confluence adds up to +5 bonus points
- Breaker Block labels visible in factors

## Configuration

Edit `engineConfig.js` to tune for your trading style:

| Parameter | Default | Looser (more signals) | Tighter (fewer signals) |
|---|---|---|---|
| OB_DISP_MULT | 1.2 | 1.0 | 1.5 |
| OB_VOL_MULT | 1.2 | 1.0 | 1.5 |
| FVG_MIN_ATR | 0.3 | 0.15 | 0.5 |
| EQH_TOLERANCE | 0.15 | 0.2 | 0.1 |
