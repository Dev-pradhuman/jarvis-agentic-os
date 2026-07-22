/**
 * Skills manager — the dynamic layer behind the Skills dashboard.
 *
 * The static `SKILLS` registry (skills.js) is what the router maps intents to.
 * This module reflects the REAL SOP files on disk (.jarvis-brain/skills/*.md),
 * tracks an enabled/disabled flag per skill (.jarvis-brain/skills-state.json), and
 * exposes CRUD so the UI can enable, disable, edit, create, and delete skills.
 *
 * A disabled skill is refused at execution time (see index.js), so toggling one off
 * genuinely stops it running — no mock state.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SKILLS } from './skills.js';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const SKILLS_DIR = path.join(PROJECTS_ROOT, '.jarvis-brain', 'skills');
const STATE_FILE = path.join(PROJECTS_ROOT, '.jarvis-brain', 'skills-state.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function idFromFile(file) {
  return file.replace(/\.md$/i, '');
}
function fileFromId(id) {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.endsWith('.md') ? safe : `${safe}.md`;
}
function labelFor(id, sop) {
  if (SKILLS[id]?.label) return SKILLS[id].label;
  const m = sop.match(/^\s*#\s+(.+)$/m);
  if (m) return m[1].trim();
  return id.replace(/^SKILL_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveState(state, id, folder) {
  const projectState = folder ? state[folder] : undefined;
  if (projectState && projectState[id] !== undefined) return projectState[id];
  const defaultState = state['_default'];
  if (defaultState && defaultState[id] !== undefined) return defaultState[id];
  return true; // enabled by default
}

/** True if a skill is currently enabled (default: enabled). */
export function isSkillEnabled(id, folder) {
  const state = readState();
  return resolveState(state, id, folder);
}

/** List every SOP on disk with its enabled state and a content preview. */
export function listSkills(folder) {
  const state = readState();
  let files = [];
  try {
    files = fs.readdirSync(SKILLS_DIR).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    files = [];
  }
  return files
    .map((f) => {
      const id = idFromFile(f);
      const full = path.join(SKILLS_DIR, f);
      let sop = '';
      let mtime = 0;
      let bytes = 0;
      try {
        sop = fs.readFileSync(full, 'utf8');
        const st = fs.statSync(full);
        mtime = st.mtimeMs;
        bytes = st.size;
      } catch {
        /* ignore */
      }
      return {
        id,
        file: f,
        label: labelFor(id, sop),
        enabled: resolveState(state, id, folder),
        registered: !!SKILLS[id], // reachable by the voice router
        bytes,
        updated: mtime,
        preview: sop.slice(0, 240),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Compact executable instructions injected into every CLI's shared context. */
export function getEnabledSkillInstructions(folder, maxChars = 12000) {
  let used = 0;
  const parts = [];
  for (const skill of listSkills(folder).filter((s) => s.enabled)) {
    const text = readSkill(skill.id).trim();
    if (!text || used >= maxChars) continue;
    const clipped = text.slice(0, Math.min(maxChars - used, 1800));
    parts.push(`## ${skill.id}\n${clipped}`);
    used += clipped.length;
  }
  return parts.join('\n\n');
}

/** Full SOP text for the editor. */
export function readSkill(id) {
  const full = path.join(SKILLS_DIR, fileFromId(id));
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return '';
  }
}

export function setSkillEnabled(id, enabled, folder) {
  const state = readState();
  const target = folder || '_default';
  if (!state[target]) state[target] = {};
  state[target][id] = !!enabled;
  writeState(state);
  return { id, enabled: !!enabled, folder };
}

/** Create or overwrite a skill's SOP file. Returns the fresh list. */
export function saveSkill(id, content, folder) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SKILLS_DIR, fileFromId(id)), content ?? '');
  return listSkills(folder);
}

/** Delete a skill's SOP file and forget its enabled flag. */
export function deleteSkill(id, folder) {
  try {
    fs.unlinkSync(path.join(SKILLS_DIR, fileFromId(id)));
  } catch {
    /* already gone */
  }
  const state = readState();
  for (const k of Object.keys(state)) {
    if (state[k][id] !== undefined) delete state[k][id];
  }
  writeState(state);
  return listSkills(folder);
}
