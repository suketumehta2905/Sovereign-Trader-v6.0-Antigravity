// IST offset = UTC+5:30
export const IST_OFFSET_HOURS = 5.5;

function getUTCHour() {
  const now = new Date();
  return now.getUTCHours() + now.getUTCMinutes() / 60;
}

function inRange(h, start, end) {
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

export function getISTTime() {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_HOURS * 3600 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} IST`;
}

const SESSION_DEFS = [
  { id: 'ASIA',     name: 'Asia Session',     start: 0,  end: 8,  color: '#a855f7' },
  { id: 'LONDON',   name: 'London Session',   start: 7,  end: 16, color: '#3b82f6' },
  { id: 'NEW_YORK', name: 'New York Session',  start: 12, end: 21, color: '#22c55e' },
  { id: 'OVERLAP',  name: 'London/NY Overlap', start: 12, end: 16, color: '#e2b340' },
];

const KILLZONE_DEFS = [
  { id: 'ASIA_KZ',     name: 'Asia KZ',        startUTC: 0,  endUTC: 2,  color: '#a855f7', ist: '05:30–07:30' },
  { id: 'LONDON_OPEN', name: 'London Open KZ', startUTC: 7,  endUTC: 9,  color: '#3b82f6', ist: '12:30–14:30' },
  { id: 'NY_OPEN',     name: 'NY Open KZ',     startUTC: 12, endUTC: 14, color: '#22c55e', ist: '17:30–19:30' },
  { id: 'SILVER',      name: 'Silver Bullet',  startUTC: 15, endUTC: 16, color: '#e2b340', ist: '20:30–21:30' },
];

export function getActiveSessions() {
  const h = getUTCHour();
  return SESSION_DEFS.filter((s) => inRange(h, s.start, s.end));
}

export function getSession() {
  const active = getActiveSessions();
  if (active.length === 0) return { name: 'Off-Hours', color: '#4a5a6a', active: false };
  const overlap = active.find((s) => s.id === 'OVERLAP');
  if (overlap) return { ...overlap, active: true };
  return { ...active[0], active: true };
}

export function getActiveKillzone() {
  const h = getUTCHour();
  return KILLZONE_DEFS.find((kz) => inRange(h, kz.startUTC, kz.endUTC)) || null;
}

export function isKillzoneActive() { return getActiveKillzone() !== null; }
export function getKillzoneScore() { return isKillzoneActive() ? 6 : 0; }

export { KILLZONE_DEFS, SESSION_DEFS };
