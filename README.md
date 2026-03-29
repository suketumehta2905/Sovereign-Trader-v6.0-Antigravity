# ♛ Sovereign Trader v6.0 — Antigravity Edition

**Advanced ICT/SMC Institutional Analytical Dashboard**

Sovereign Trader is a high-performance market analysis platform built for professional traders. It combines **Inner Circle Trader (ICT)** and **Smart Money Concepts (SMC)** logic into a unified, real-time scanning and charting engine.

## 🚀 Core Features

- **Institutional Scanner**: 
    - Real-time **Confluence Scoring** (0-100).
    - Status Gates: **Valid Confluence**, **Rejected**, or **Anchor Failed**.
    - Live tracking of Order Blocks (OBs), Fair Value Gaps (FVGs), and Liquidity Pools.
- **Advanced Charting**:
    - Powered by **Lightweight Charts**.
    - **Auto Trendlines (Auto TL)**: Automated diagonal liquidity mapping.
    - **SR Zones**: Macro-pivot-based support and resistance zone mapping.
    - Premium/Discount/Equilibrium matrix integration.
- **Multi-Source Data Engine**:
    - **TwelveData** integration for Spot Forex/Gold.
    - **Yahoo Finance Proxy** (Cloudflare Worker v5) for 24/7 Futures data.
- **Modern UI/UX**:
    - Global **Reference-Matched Theme** (Dark/Light).
    - Responsive, high-performance design optimized for low-latency analysis.

## 🛠 Tech Stack

- **Frontend**: React, Vite, CSS Modules
- **Charts**: Lightweight Charts
- **Backend/Proxy**: Cloudflare Workers
- **AI**: Google Gemini 1.5 Flash Integration

## 📦 Deployment

The project is configured for **Firebase Hosting**. 

```bash
npm run build
npx firebase-tools deploy --only hosting
```

---

*Built with precision and restored with Antigravity.*
