import path from 'node:path';

/** Resolve a user-selected project folder without allowing an escape from ROOT. */
export function projectPath(root, folder = '') {
  if (!folder) return root;
  if (typeof folder !== 'string' || path.isAbsolute(folder)) throw new Error('Invalid project folder.');
  const candidate = path.resolve(root, folder);
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return candidate;
  throw new Error('Project folder must stay inside the configured projects root.');
}

export function localOrigins() {
  return (process.env.JARVIS_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((x) => x.trim()).filter(Boolean);
}
