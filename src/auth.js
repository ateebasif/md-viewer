// Shared secret between the CLI and the server, so other local processes and users
// can't drive the server or read files through it. Lives in ~/.config/mdv/secret (0600).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// MDV_CONFIG_DIR lets tests run an isolated server without touching your real settings.
export const CONFIG_DIR = process.env.MDV_CONFIG_DIR || path.join(os.homedir(), '.config', 'mdv');
const SECRET_FILE = path.join(CONFIG_DIR, 'secret');

function read() {
  try {
    const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    return /^[a-f0-9]{64}$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

export function loadSecret() {
  const existing = read();
  if (existing) return existing;
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const fresh = crypto.randomBytes(32).toString('hex');
  try {
    // 'wx' so two processes creating it at once can't end up with different secrets.
    fs.writeFileSync(SECRET_FILE, fresh + '\n', { mode: 0o600, flag: 'wx' });
    return fresh;
  } catch (e) {
    if (e.code === 'EEXIST' && read()) return read();
    // An invalid file is left over: replace it.
    fs.writeFileSync(SECRET_FILE, fresh + '\n', { mode: 0o600 });
    fs.chmodSync(SECRET_FILE, 0o600);
    return fresh;
  }
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
