import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './brain.js';
import { ENV_FILE } from './env.js';
export function setupStatus() { return { configured: !!process.env.JARVIS_PROJECTS_ROOT, projectsRoot: ROOT, brainReady: fs.existsSync(path.join(ROOT, '.jarvis-brain', 'BRAIN.md')) }; }
export function saveSetup({ projectsRoot, createBrain }) {
  const root = path.resolve(String(projectsRoot || '').trim());
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Choose an existing projects folder.');
  const lines = [`JARVIS_PROJECTS_ROOT=${root}`];
  fs.writeFileSync(ENV_FILE, `${lines.join('\n')}\n`, 'utf8');
  return { restartRequired: true, projectsRoot: root, brainPath: createBrain ? path.join(root, '.jarvis-brain') : null };
}
