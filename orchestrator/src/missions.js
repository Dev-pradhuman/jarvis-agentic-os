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
export const DEFAULT_PIPELINE = Object.fromEntries(STAGES.map((stage) => [stage, {
  automated: true,
  agent: ROUTING_PROFILES[stage].preferred,
  effort: stage === 'Implement' ? 'high' : 'medium',
}]));
export function normalizePipeline(input = {}) {
  return Object.fromEntries(STAGES.map((stage) => {
    const base = DEFAULT_PIPELINE[stage]; const value = input[stage] || {};
    return [stage, { automated: value.automated !== false, agent: String(value.agent || base.agent), effort: String(value.effort || base.effort) }];
  }));
}
export function listMissions(folder = '') { return load().filter((x) => !folder || x.folder === folder).sort((a,b) => b.updatedAt - a.updatedAt); }
export function getMission(id) { return load().find((x) => x.id === id) || null; }
export function createMission({ title, folder = '', mode = 'manual', pipeline }) { const now = Date.now(); const item = { id: randomUUID(), title: String(title || '').trim(), folder, mode: mode === 'automatic' ? 'automatic' : 'manual', pipeline: normalizePipeline(pipeline), stage: 0, status: 'ready', history: [{ at: now, type: 'created', text: 'Mission created' }], createdAt: now, updatedAt: now }; if (!item.title) throw new Error('Mission title is required.'); const all = load(); all.push(item); save(all); return item; }
export function updateMission(id, patch = {}) { const all = load(); const item = all.find((x) => x.id === id); if (!item) throw new Error('Mission not found.'); Object.assign(item, patch, { updatedAt: Date.now() }); item.history.push({ at: Date.now(), type: patch.status || 'updated', text: patch.note || `Stage: ${STAGES[item.stage]}` }); save(all); return item; }

/** Record a stage result and, in automatic mode, make the next stage ready. */
export function completeMissionStage(id, stageName, status, output = '') {
  const all = load();
  const item = all.find((x) => x.id === id);
  if (!item) throw new Error('Mission not found.');
  const now = Date.now();
  const summary = String(output || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const expectedStage = STAGES[item.stage];
  if (stageName && stageName !== expectedStage) return { mission: item, advanced: false, ignored: true };
  if (status !== 'success') {
    item.status = 'blocked';
    item.history.push({ at: now, type: 'blocked', text: `${expectedStage} ${status}. ${summary || 'Review and retry this stage.'}` });
  } else if (item.mode === 'automatic' && item.stage < STAGES.length - 1) {
    const next = STAGES[item.stage + 1];
    item.stage += 1;
    item.status = 'ready';
    const autoNext = normalizePipeline(item.pipeline)[next].automated;
    item.history.push({ at: now, type: 'handoff', text: `${expectedStage} completed. ${autoNext ? `Automatic handoff to ${next}.` : `${next} is set to manual.`} ${summary}`.trim() });
  } else if (item.mode === 'automatic') {
    item.status = 'done';
    item.history.push({ at: now, type: 'done', text: `Test passed. Mission completed. ${summary}`.trim() });
  } else {
    item.status = 'ready';
    item.history.push({ at: now, type: 'success', text: `${expectedStage} completed. ${summary}`.trim() });
  }
  item.updatedAt = now;
  save(all);
  return { mission: item, advanced: status === 'success' && item.mode === 'automatic' && item.status === 'ready' && normalizePipeline(item.pipeline)[STAGES[item.stage]].automated };
}
