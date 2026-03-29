export const SYMBOLS = [
  { id: 'XAUUSD', name: 'Gold',   yf: 'XAUUSD=X', yfCandle: 'GC=F', color: '#e2b340', icon: '\u2B19',
    pipMultiplier: 10,   pipDigits: 2, pipValuePerLot: 10, priceDigits: 2 },
  { id: 'XAGUSD', name: 'Silver', yf: 'XAGUSD=X', yfCandle: 'SI=F', color: '#94a3b8', icon: '\u25C8',
    pipMultiplier: 100,  pipDigits: 3, pipValuePerLot: 50, priceDigits: 3 },
  { id: 'USOIL',  name: 'Crude',  yf: 'CL=F', yfCandle: 'CL=F', color: '#f97316', icon: '\u25C9',
    pipMultiplier: 100,  pipDigits: 2, pipValuePerLot: 10, priceDigits: 2 },
  { id: 'NATGAS', name: 'NatGas', yf: 'NG=F', yfCandle: 'NG=F', color: '#22c55e', icon: '\u25C6',
    pipMultiplier: 1000, pipDigits: 3, pipValuePerLot: 10, priceDigits: 3 },
  { id: 'MCX:GOLD', name: 'MCX Gold', yf: 'MGC=F', yfCandle: 'MGC=F', color: '#e2b340', icon: '🇮🇳',
    pipMultiplier: 1, pipDigits: 0, pipValuePerLot: 100, priceDigits: 0 },
  { id: 'MCX:SILVER', name: 'MCX Silver', yf: 'SIL=F', yfCandle: 'SIL=F', color: '#94a3b8', icon: '🇮🇳',
    pipMultiplier: 1, pipDigits: 0, pipValuePerLot: 30, priceDigits: 0 },
  { id: 'MCX:CRUDEOIL', name: 'MCX Crude', yf: 'CL=F', yfCandle: 'CL=F', color: '#f97316', icon: '🇮🇳',
    pipMultiplier: 1, pipDigits: 0, pipValuePerLot: 100, priceDigits: 0 },
];

export const DEFAULT_WORKER_URL = 'https://ict-data-proxy.suketu29.workers.dev';
export const USD_INR = 83;

export const SCORE_SIGNAL = 40;
export const SCORE_HIGH = 70;

export const LS_KEYS = {
  SETTINGS: 'st_settings',
  SIGNALS: 'st_signals',
  TRADES: 'st_trades',
};

export const WFO_IS_RATIO = 0.70;
