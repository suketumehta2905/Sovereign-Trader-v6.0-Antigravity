export function fmt(price, digits = 2) {
  if (price === null || price === undefined || isNaN(price)) return '—';
  return Number(price).toFixed(digits);
}
export function fmtPrice(price, sym) {
  if (!price || !sym) return '—';
  return fmt(price, sym.priceDigits || 2);
}
export function fmtINR(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '₹—';
  const abs = Math.abs(amount);
  let formatted;
  if (abs >= 10000000) formatted = (amount / 10000000).toFixed(2) + 'Cr';
  else if (abs >= 100000) formatted = (amount / 100000).toFixed(2) + 'L';
  else if (abs >= 1000) formatted = (amount / 1000).toFixed(1) + 'K';
  else formatted = amount.toFixed(2);
  return '₹' + formatted;
}
export function fmtINRFull(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '₹—';
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtPct(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—%';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(digits) + '%';
}
export function fmtPips(pips, digits = 1) {
  if (pips === null || pips === undefined || isNaN(pips)) return '—';
  return Number(pips).toFixed(digits) + ' pips';
}
export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
