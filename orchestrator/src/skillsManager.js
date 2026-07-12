/**
 * Skills manager — the dynamic layer behind the Skills dashboard.
 *
 * The static `SKILLS` registry (skills.js) is what the router maps intents to.
 * This module reflects the REAL SOP files on disk (vault/99_System/Skills/*.md),
 * tracks an enabled/disabled flag per skill (.jarvis-brain/skills-state.json), and
 * exposes CRUD so the UI can enable, disable, edit, create, and delete skills.
 *
 * A disabled skill is refused at execution time (see index.js), so toggling one off
 * genuinely stops it running — no mock state.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS } from './skills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.JARVIS_VAULT
  ? path.resolve(__dirname, '..', process.env.JARVIS_VAULT)
  : path.resolve(__dirname, '../../vault/Jarvis_Vault');
const SKILLS_DIR = path.join(VAULT, '99_System', 'Skills');

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
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
  // Derive a friendly label from a leading "# Title" line, else the id.
  const m = sop.match(/^\s*#\s+(.+)$/m);
  if (m) return m[1].trim();
  return id.replace(/^SKILL_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** True if a skill is currently enabled (default: enabled). */
export function isSkillEnabled(id) {
  const state = readState();
  return state[id] !== false;
}

/** List every SOP on disk with its enabled state and a content preview. */
export function listSkills() {
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
        enabled: state[id] !== false,
        registered: !!SKILLS[id], // reachable by the voice router
        bytes,
        updated: mtime,
        preview: sop.slice(0, 240),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
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

export function setSkillEnabled(id, enabled) {
  const state = readState();
  state[id] = !!enabled;
  writeState(state);
  return { id, enabled: !!enabled };
}

/** Create or overwrite a skill's SOP file. Returns the fresh list. */
export function saveSkill(id, content) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SKILLS_DIR, fileFromId(id)), content ?? '');
  return listSkills();
}

/** Delete a skill's SOP file and forget its enabled flag. */
export function deleteSkill(id) {
  try {
    fs.unlinkSync(path.join(SKILLS_DIR, fileFromId(id)));
  } catch {
    /* already gone */
  }
  const state = readState();
  delete state[id];
  writeState(state);
  return listSkills();
}
