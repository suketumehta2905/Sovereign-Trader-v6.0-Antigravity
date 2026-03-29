/**
 * driveSync.js — Google Drive automatic backup/restore
 *
 * Uses Google Identity Services (OAuth2 token flow) + Drive REST API.
 * Saves a single file  "sovereign-trader-backup.json"  to the user's Drive.
 * Visible in Drive → the user can see and download it like any file.
 *
 * ONE-TIME SETUP:
 *   1. Google Cloud Console → APIs & Services → Library → enable "Google Drive API"
 *   2. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
 *      → Application type: Web application
 *      → Authorised JavaScript origins: http://localhost:5173
 *      → Copy the Client ID (looks like: 123456789-xxx.apps.googleusercontent.com)
 *   3. Paste it in Settings → Google Drive → Client ID field
 *   4. Click Connect — allow permissions once → done, auto-backup starts
 */

import { lsGet, lsSet } from './localStorage';
import { LS_KEYS } from '../config/constants';

const DRIVE_SCOPE    = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_NAME    = 'sovereign-trader-backup.json';
const LS_DRIVE_STATE = 'st_drive';

// ── Internal state helpers ────────────────────────────────────────────────────

function getState()         { return lsGet(LS_DRIVE_STATE, {}); }
function patchState(update) { lsSet(LS_DRIVE_STATE, { ...getState(), ...update }); }

// ── Public read-only helpers ──────────────────────────────────────────────────

export function isDriveConnected() {
  const { token, tokenExpiry } = getState();
  return !!(token && Date.now() < (tokenExpiry || 0));
}

export function getDriveInfo() {
  const { email, lastBackup, clientId } = getState();
  return { email: email || '', lastBackup: lastBackup || null, clientId: clientId || '', connected: isDriveConnected() };
}

export function getClientId() {
  return getState().clientId || '';
}

export function saveClientId(id) {
  patchState({ clientId: id.trim() });
}

// ── Load Google Identity Services script ──────────────────────────────────────

let gisReady = null;
function loadGIS() {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s   = document.createElement('script');
    s.src     = 'https://accounts.google.com/gsi/client';
    s.async   = true;
    s.onload  = () => resolve();
    s.onerror = () => { gisReady = null; reject(new Error('GIS load failed')); };
    document.head.appendChild(s);
  });
  return gisReady;
}

// ── OAuth token request ───────────────────────────────────────────────────────

export async function connectDrive(clientId) {
  if (!clientId) throw new Error('Client ID is required');
  await loadGIS();
  patchState({ clientId: clientId.trim() });

  return new Promise((resolve, reject) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope:     DRIVE_SCOPE,
      callback:  async (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }

        const expiry = Date.now() + Number(resp.expires_in || 3600) * 1000;
        patchState({ token: resp.access_token, tokenExpiry: expiry });

        // Fetch display email
        try {
          const r    = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
                         { headers: { Authorization: `Bearer ${resp.access_token}` } });
          const info = await r.json();
          patchState({ email: info.email || '' });
        } catch {}

        resolve({ ok: true });
      },
    });
    tc.requestAccessToken({ prompt: 'consent' });
  });
}

export async function silentRefresh() {
  const { clientId } = getState();
  if (!clientId) return false;
  try {
    await loadGIS();
    return new Promise((resolve) => {
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope:     DRIVE_SCOPE,
        callback:  (resp) => {
          if (resp.error) { resolve(false); return; }
          patchState({ token: resp.access_token, tokenExpiry: Date.now() + Number(resp.expires_in || 3600) * 1000 });
          resolve(true);
        },
      });
      tc.requestAccessToken({ prompt: '' });
    });
  } catch { return false; }
}

export function disconnectDrive() {
  const { token, clientId } = getState();
  try { window.google?.accounts?.oauth2?.revoke(token, () => {}); } catch {}
  lsSet(LS_DRIVE_STATE, { clientId }); // keep clientId, wipe token + email + fileId
}

// ── Drive REST helpers ────────────────────────────────────────────────────────

function authHeader() {
  const { token } = getState();
  if (!token) throw new Error('Drive not authenticated');
  return `Bearer ${token}`;
}

async function findOrGetFileId() {
  const { fileId } = getState();
  const auth = authHeader();

  // Verify stored fileId is still valid
  if (fileId) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id`,
      { headers: { Authorization: auth } }
    );
    if (r.ok) return fileId;
    patchState({ fileId: null }); // stale — clear it
  }

  // Search Drive for existing backup file
  const q = encodeURIComponent(`name='${BACKUP_NAME}' and trashed=false`);
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: auth } }
  );
  if (!r.ok) return null;
  const { files } = await r.json();
  if (files?.length > 0) { patchState({ fileId: files[0].id }); return files[0].id; }
  return null;
}

// ── Backup ────────────────────────────────────────────────────────────────────

export async function backupToDrive() {
  if (!isDriveConnected()) {
    const refreshed = await silentRefresh();
    if (!refreshed) return { ok: false, msg: 'Token expired — reconnect Drive in Settings' };
  }

  const payload = JSON.stringify({
    version:      3,
    backedUpAt:   new Date().toISOString(),
    settings:     lsGet(LS_KEYS.SETTINGS,      {}),
    signals:      lsGet(LS_KEYS.SIGNALS,        []),
    paperPos:     lsGet('st_paper_pos',         []),
    paperHist:    lsGet('st_paper_hist',        []),
    paperBalance: lsGet('st_paper_bal',         null),
    tradeLog:     lsGet('st_trade_log',         []),
  }, null, 2);

  const auth = authHeader();

  try {
    const existingId = await findOrGetFileId();

    if (existingId) {
      // Update file content only (metadata unchanged)
      const r = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
        { method: 'PATCH', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: payload }
      );
      if (!r.ok) throw new Error(`Drive update error ${r.status}`);
    } else {
      // Create new file with metadata + content in a single multipart request
      const boundary = 'sov_trader_boundary_X9z3';
      const multipart =
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        JSON.stringify({ name: BACKUP_NAME, mimeType: 'application/json' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        payload +
        `\r\n--${boundary}--`;

      const r = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        {
          method:  'POST',
          headers: { Authorization: auth, 'Content-Type': `multipart/related; boundary="${boundary}"` },
          body:    multipart,
        }
      );
      if (!r.ok) throw new Error(`Drive create error ${r.status}`);
      const created = await r.json();
      patchState({ fileId: created.id });
    }

    const lastBackup = new Date().toISOString();
    patchState({ lastBackup });
    return { ok: true, lastBackup };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────

export async function restoreFromDrive() {
  if (!isDriveConnected()) return { ok: false, msg: 'Connect Drive first' };

  try {
    const fileId = await findOrGetFileId();
    if (!fileId) return { ok: false, msg: 'No backup file found in your Drive' };

    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: authHeader() } }
    );
    if (!r.ok) throw new Error(`Download failed: ${r.status}`);

    const backup = await r.json();
    if (!backup.settings) throw new Error('File does not look like a Sovereign Trader backup');

    if (backup.settings)                          lsSet(LS_KEYS.SETTINGS,     backup.settings);
    if (Array.isArray(backup.signals))            lsSet(LS_KEYS.SIGNALS,       backup.signals);
    if (Array.isArray(backup.paperPos))           lsSet('st_paper_pos',        backup.paperPos);
    if (Array.isArray(backup.paperHist))          lsSet('st_paper_hist',       backup.paperHist);
    if (backup.paperBalance !== undefined)        lsSet('st_paper_bal',        backup.paperBalance);
    if (Array.isArray(backup.tradeLog))           lsSet('st_trade_log',        backup.tradeLog);

    const sk = backup.settings?.syncKey;
    if (sk) {
      try { document.cookie = `sov_key=${encodeURIComponent(sk)}; max-age=31536000; path=/`; } catch {}
    }

    return {
      ok:      true,
      signals: backup.signals?.length  || 0,
      trades:  backup.paperTrades?.length || 0,
      backedUpAt: backup.backedUpAt || 'unknown',
    };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}
