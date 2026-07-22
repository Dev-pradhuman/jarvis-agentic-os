/**
 * Live system-state provider. Gathers REAL data from the filesystem, process, and
 * runtime — no mock values — and assembles the snapshot the frontend renders.
 *
 * Sources:
 *   vitals.CONTEXT  → total vault content size (estimated tokens)
 *   vitals.MEMORY   → orchestrator process RSS
 *   vitals.AGENTS   → skills currently running
 *   vitals.LATENCY  → measured event-loop lag
 *   documents       → most-recently-modified vault files
 *   directives      → parsed from 99_System/directives.md (user-editable)
 *   calendar        → parsed from 99_System/calendar.json (user-editable)
 *   tokens          → real cumulative tokens processed by skill runs (rolling series)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VAULT_PATH } from './brain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.JARVIS_VAULT
  ? path.resolve(__dirname, '..', process.env.JARVIS_VAULT)
  : path.resolve(__dirname, '../../vault/Jarvis_Vault');

const estTokens = (chars) => Math.round(chars / 4);
const clampPct = (n) => Math.max(2, Math.min(100, Math.round(n)));

function fmtK(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function relTime(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 172800) return 'yday';
  return `${Math.round(s / 86400)}d`;
}

function safeWalk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) safeWalk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// ── Latency: event-loop lag ────────────────────────────────────────────────
let lagMs = 0;
let lastTick = Date.now();
const INTERVAL = 500;
setInterval(() => {
  const now = Date.now();
  lagMs = Math.max(0, now - lastTick - INTERVAL);
  lastTick = now;
}, INTERVAL).unref?.();

// ── Token accounting: real cumulative tokens from skill runs ────────────────
let cumulativeTokens = 0;
const tokenSeries = new Array(20).fill(0);

export function recordTokens(chars) {
  cumulativeTokens += estTokens(chars);
}

/** Called on each broadcast tick to append the current cumulative total. */
export function sampleTokens() {
  tokenSeries.push(cumulativeTokens);
  tokenSeries.shift();
}

// ── Vitals ─────────────────────────────────────────────────────────────────
function getVitals(runningCount) {
  let totalBytes = 0;
  for (const f of safeWalk(VAULT)) {
    try {
      totalBytes += fs.statSync(f).size;
    } catch {
      /* ignore */
    }
  }
  const contextTokens = estTokens(totalBytes);
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);

  return [
    { label: 'CONTEXT', value: fmtK(contextTokens), pct: clampPct((contextTokens / 50000) * 100), tone: 'accent' },
    { label: 'MEMORY', value: `${rssMb}MB`, pct: clampPct((rssMb / 512) * 100), tone: 'accent' },
    { label: 'AGENTS', value: String(runningCount).padStart(2, '0'), pct: clampPct(runningCount * 25), tone: 'success' },
    { label: 'LATENCY', value: `${Math.round(lagMs)}ms`, pct: clampPct((lagMs / 50) * 100), tone: 'success' },
  ];
}

// ── Recent documents ───────────────────────────────────────────────────────
function getDocuments() {
  return safeWalk(VAULT)
    .filter((f) => !f.endsWith('.gitkeep'))
    .map((f) => {
      let m = 0;
      try {
        m = fs.statSync(f).mtimeMs;
      } catch {
        /* ignore */
      }
      return { id: path.relative(VAULT, f), name: path.basename(f), when: relTime(m), _m: m };
    })
    .sort((a, b) => b._m - a._m)
    .slice(0, 6)
    .map(({ _m, ...rest }) => rest);
}

// ── Directives (99_System/directives.md) ───────────────────────────────────
function getDirectives() {
  try {
    const txt = fs.readFileSync(path.join(VAULT, '99_System', 'directives.md'), 'utf8');
    const out = [];
    for (const line of txt.split(/\r?\n/)) {
      // Format:  - [P0] Ship Q3 retrospective deck
      const m = line.match(/^\s*-\s*\[(P\d)\]\s*(.+?)\s*$/);
      if (m) out.push({ id: `d${out.length}`, tag: m[1], title: m[2] });
    }
    return out.slice(0, 3);
  } catch {
    return [];
  }
}

// ── Calendar (99_System/calendar.json) ──────────────────────────────────────
function getCalendar() {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(VAULT, '99_System', 'calendar.json'), 'utf8'));
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 8).map((e, i) => ({ id: `e${i}`, ...e }));
  } catch {
    return [];
  }
}

/** Assemble the full live snapshot. */
export function getState(runningCount) {
  return {
    vitals: getVitals(runningCount),
    documents: getDocuments(),
    directives: getDirectives(),
    calendar: getCalendar(),
    tokens: [...tokenSeries],
    tokensLabel: fmtK(cumulativeTokens),
  };
}

export function getProjectDashboard(folder) {
  if (!folder) return null;
  const slug = folder.replace(/[^a-zA-Z0-9._-]/g, '_');
  const projectVault = path.join(VAULT_PATH, 'folders', slug);
  
  function getProjectDocs() {
    return safeWalk(projectVault)
      .filter((f) => !f.endsWith('.gitkeep'))
      .map((f) => {
        let m = 0;
        try { m = fs.statSync(f).mtimeMs; } catch {}
        return { id: path.relative(projectVault, f), name: path.basename(f), when: relTime(m), _m: m };
      })
      .sort((a, b) => b._m - a._m)
      .slice(0, 6)
      .map(({ _m, ...rest }) => rest);
  }
  
  return {
    documents: getProjectDocs(),
    // Fall back to main brain directives/calendar if project doesn't have them
    directives: getDirectives(),
    calendar: getCalendar()
  };
}
