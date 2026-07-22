/**
 * Ruflow — token-lean, higher-quality mode for every CLI and API.
 *
 * Two halves, both toggleable per project (with a global _default), mirroring the
 * MCP/skills/plugins enable model:
 *
 *  1) EFFICIENCY POLICY — a compact system directive injected into every run:
 *     be terse, structured, reuse memory, minimal correct change. Fewer output
 *     tokens, better-shaped answers.
 *
 *  2) MEMORY BANK — a small set of distilled per-project notes
 *     (.jarvis-brain[/folders/<slug>]/memory-bank/*.md) that REPLACE the verbose
 *     "recent conversations" dump when ruflow is on. A rolling, capped digest is
 *     injected instead of raw history — that's the real token win.
 *
 * Auto model/effort routing lives in index.js (pickRun) and reads isRuflowEnabled.
 *
 * State file: {projectsRoot}/.jarvis-brain/ruflow.json
 *   { enabled: { _default: bool, <folder>: bool } }
 */

import fs from 'node:fs';
import path from 'node:path';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const BRAIN_ROOT = path.join(PROJECTS_ROOT, '.jarvis-brain');
const STATE_FILE = path.join(BRAIN_ROOT, 'ruflow.json');

const SECTIONS = ['activeContext', 'decisions', 'patterns', 'progress'];
const SECTION_CAP = 1800; // chars per memory-bank file injected (keeps context lean)
const PROGRESS_MAX = 40; // rolling lines kept in progress.md

export const RUFLOW_POLICY = [
  '===== RUFLOW MODE (token-efficient, high quality) =====',
  '- Be maximally concise: no filler, no restating the request, no apologies or preamble.',
  '- Prefer structured output — short bullets or code — over prose. One pass, no hedging.',
  '- Reuse the MEMORY BANK below as ground truth; do NOT re-derive or repeat known context.',
  '- Make the minimal correct change; only ask a question if genuinely blocked.',
  '- Optimize for the fewest output tokens that still fully and correctly solve the task.',
  '===== END RUFLOW =====',
].join('\n');

function slug(folder) {
  return (folder || '_root').replace(/[^a-zA-Z0-9._-]/g, '_');
}
function bankDir(folder) {
  return folder
    ? path.join(BRAIN_ROOT, 'folders', slug(folder), 'memory-bank')
    : path.join(BRAIN_ROOT, 'memory-bank');
}
function sectionFile(folder, section) {
  return path.join(bankDir(folder), `${section}.md`);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { enabled: {} };
  }
}
function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Enabled if a per-folder flag is set, else the global _default (default: OFF). */
export function isRuflowEnabled(folder) {
  const { enabled = {} } = readState();
  if (folder && enabled[folder] !== undefined) return !!enabled[folder];
  if (enabled._default !== undefined) return !!enabled._default;
  return false;
}

export function setRuflowEnabled(on, folder) {
  const state = readState();
  state.enabled = state.enabled || {};
  state.enabled[folder || '_default'] = !!on;
  writeState(state);
  return getRuflowState(folder);
}

function readSection(folder, section) {
  try {
    return fs.readFileSync(sectionFile(folder, section), 'utf8');
  } catch {
    return '';
  }
}

/** UI/state snapshot: toggle + the raw memory-bank files for the active scope. */
export function getRuflowState(folder) {
  const files = {};
  for (const s of SECTIONS) files[s] = readSection(folder, s);
  return {
    enabled: isRuflowEnabled(folder),
    globalEnabled: isRuflowEnabled(''),
    folder: folder || '',
    files,
  };
}

/** Overwrite one memory-bank section (used by the UI editor). */
export function writeMemoryBank(folder, section, content) {
  if (!SECTIONS.includes(section)) throw new Error(`unknown section ${section}`);
  fs.mkdirSync(bankDir(folder), { recursive: true });
  fs.writeFileSync(sectionFile(folder, section), content ?? '');
  return getRuflowState(folder);
}

/**
 * Roll a completed exchange into the memory bank, cheaply (no LLM):
 * activeContext = the latest task; progress = a capped rolling log. Keeps the
 * injected context small and current so full history recall isn't needed.
 *
 * Failed/stopped runs are skipped: activeContext is overwritten on every call, so
 * one 402 or CLI usage dump would otherwise become "the current task" for every
 * agent that reads the bank next.
 */
export function recordToMemoryBank(folder, { prompt = '', response = '', cli = '', status = 'ok' } = {}) {
  if (!isRuflowEnabled(folder)) return;
  if (status === 'error' || status === 'stopped') return;
  try {
    fs.mkdirSync(bankDir(folder), { recursive: true });
    const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

    fs.writeFileSync(
      sectionFile(folder, 'activeContext'),
      `# Active context\n_Last updated ${stamp}_\n\n**Current task:** ${oneLine(prompt, 400)}\n\n**Last result:** ${oneLine(response, 500)}\n`,
    );

    const line = `- ${stamp} [${cli}] ${oneLine(prompt, 120)} → ${oneLine(response, 140)}`;
    const prev = readSection(folder, 'progress').split('\n').filter((l) => l.startsWith('- '));
    const next = [...prev, line].slice(-PROGRESS_MAX);
    fs.writeFileSync(sectionFile(folder, 'progress'), `# Progress log\n\n${next.join('\n')}\n`);
  } catch {
    /* memory bank is best-effort; never block a chat */
  }
}

/**
 * The compact injection for getContext when ruflow is on: policy + a capped digest
 * of each memory-bank section. Returns '' when ruflow is off (caller keeps normal
 * recall). When on, the caller SHOULD drop verbose recall in favor of this.
 */
export function getRuflowInjection(folder) {
  if (!isRuflowEnabled(folder)) return '';
  const parts = [RUFLOW_POLICY, '===== MEMORY BANK (distilled project memory) ====='];
  let any = false;
  for (const s of SECTIONS) {
    const body = readSection(folder, s).trim();
    if (body) {
      any = true;
      parts.push(body.length > SECTION_CAP ? body.slice(0, SECTION_CAP) + '\n…(truncated)' : body);
    }
  }
  if (!any) parts.push('(empty — will fill as you work)');
  parts.push('===== END MEMORY BANK =====');
  return parts.join('\n\n');
}
