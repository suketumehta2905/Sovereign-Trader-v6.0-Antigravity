import { SYMBOLS } from '../config/constants';
const USD_INR = 83;

export const getSymbol = (id) => SYMBOLS.find((s) => s.id === id) || SYMBOLS[0];

export function calcPips(symId, price1, price2) {
  const sym = typeof symId === 'string' ? getSymbol(symId) : symId;
  return Math.abs(price1 - price2) * (sym?.pipMultiplier || 10);
}

export function pipsToINR(symId, pips, lotSize = 1) {
  const sym = typeof symId === 'string' ? getSymbol(symId) : symId;
  return pips * (sym?.pipValuePerLot || 10) * lotSize * USD_INR;
}

export function calcPosition({ symId, entry, sl, tp1, tp2, lotSize = 1 }) {
  const sym = typeof symId === 'string' ? getSymbol(symId) : symId;
  if (!sym || !entry || !sl) return null;
  const direction = sl < entry ? 'LONG' : 'SHORT';
  const slPips = calcPips(sym, entry, sl);
  const tp1Pips = tp1 ? calcPips(sym, entry, tp1) : 0;
  const tp2Pips = tp2 ? calcPips(sym, entry, tp2) : 0;
  const riskINR = pipsToINR(sym, slPips, lotSize);
  const tp1INR = pipsToINR(sym, tp1Pips, lotSize);
  const tp2INR = pipsToINR(sym, tp2Pips, lotSize);
  const rrTp1 = slPips > 0 ? +(tp1Pips / slPips).toFixed(2) : 0;
  const rrTp2 = slPips > 0 ? +(tp2Pips / slPips).toFixed(2) : 0;
  return { direction, slPips: +slPips.toFixed(sym.pipDigits || 2), tp1Pips: +tp1Pips.toFixed(sym.pipDigits || 2), tp2Pips: +tp2Pips.toFixed(sym.pipDigits || 2), riskINR: Math.round(riskINR), tp1INR: Math.round(tp1INR), tp2INR: Math.round(tp2INR), rrTp1, rrTp2 };
}

export function recommendedLots({ symId, entry, sl, riskPct = 1, accountINR = 1000000 }) {
  const sym = typeof symId === 'string' ? getSymbol(symId) : symId;
  if (!sym || !entry || !sl) return 0;
  const riskAmount = accountINR * (riskPct / 100);
  const slPips = calcPips(sym, entry, sl);
  if (slPips === 0) return 0;
  const lots = riskAmount / (slPips * sym.pipValuePerLot * USD_INR);
  return +Math.max(0.01, lots).toFixed(2);
}
