import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE = path.join(process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects', '.jarvis-brain', 'missions.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const save = (items) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(items, null, 2)); };
export const STAGES = ['Research', 'Plan', 'Implement', 'Review', 'Test'];
export const ROUTING_PROFILES = {
  Research: { preferred: 'gemini', fallback: 'api:perplexity', reason: 'large context and current research' },
  Plan: { preferred: 'claude', fallback: 'gemini', reason: 'architecture and synthesis' },
  Implement: { preferred: 'codex', fallback: 'claude', reason: 'code changes and tests' },
  Review: { preferred: 'claude', fallback: 'codex', reason: 'independent review' },
  Test: { preferred: 'codex', fallback: 'gemini', reason: 'execution and debugging' },
};
export function listMissions(folder = '') { return load().filter((x) => !folder || x.folder === folder).sort((a,b) => b.updatedAt - a.updatedAt); }
export function createMission({ title, folder = '' }) { const now = Date.now(); const item = { id: randomUUID(), title: String(title || '').trim(), folder, stage: 0, status: 'ready', history: [{ at: now, type: 'created', text: 'Mission created' }], createdAt: now, updatedAt: now }; if (!item.title) throw new Error('Mission title is required.'); const all = load(); all.push(item); save(all); return item; }
export function updateMission(id, patch = {}) { const all = load(); const item = all.find((x) => x.id === id); if (!item) throw new Error('Mission not found.'); Object.assign(item, patch, { updatedAt: Date.now() }); item.history.push({ at: Date.now(), type: patch.status || 'updated', text: patch.note || `Stage: ${STAGES[item.stage]}` }); save(all); return item; }
