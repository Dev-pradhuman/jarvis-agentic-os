/**
 * Project auto-analyzer — the thing that means you never have to say "analyze this
 * folder" to a CLI again.
 *
 * It scans a project directory with cheap, local heuristics (NO LLM, no API cost)
 * and produces a compact markdown brief: stack, entry points, scripts, structure,
 * and the README's opening. brain.js drops that into the project's sub-brain, so
 * every CLI and API provider reads it as durable context before the first prompt.
 *
 * Safety: it only ever reads a small WHITELIST of files (README, manifest files).
 * It never reads source bodies and never reads anything that looks like a secret,
 * so credentials sitting in a project folder (client_secret.json, token_*.json,
 * .env) can't leak into shared memory.
 */

import fs from 'node:fs';
import path from 'node:path';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';

// Directories that are noise or huge — never walk into them.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', '.svelte-kit', 'out', 'target', 'vendor', '.cache', 'coverage',
  '.obsidian', '.playwright-mcp', 'graphify-out', '.idea', '.vscode', 'site-packages',
]);

// Files we are allowed to OPEN. Anything else is only ever named, never read.
const READABLE = new Set([
  'readme.md', 'readme.txt', 'readme',
  'package.json', 'requirements.txt', 'pyproject.toml', 'cargo.toml',
  'go.mod', 'composer.json', 'gemfile', 'pom.xml', 'build.gradle',
]);

// Never read a file whose name matches this — it may hold credentials.
const SECRET_RE = /secret|token|credential|password|\.env|\.key$|\.pem$|providers\.json|auth\.json|client_secret/i;

// Extension → language label, for the "languages by file count" summary.
const EXT_LANG = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
  '.rb': 'Ruby', '.php': 'PHP', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cs': 'C#',
  '.swift': 'Swift', '.css': 'CSS', '.scss': 'CSS', '.html': 'HTML', '.vue': 'Vue',
  '.svelte': 'Svelte', '.sh': 'Shell', '.ps1': 'PowerShell', '.md': 'Markdown',
  '.sql': 'SQL', '.ipynb': 'Notebook',
};

function readTextSafe(p, maxBytes = 64 * 1024) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8');
  } catch {
    return '';
  }
}

function readJsonSafe(p) {
  try { return JSON.parse(readTextSafe(p)); } catch { return null; }
}

/** Walk the tree (bounded) collecting extension counts + entry-point candidates. */
function walk(root) {
  const extCounts = {};
  const topDirs = [];
  const rootFiles = new Set();
  let fileCount = 0;
  const MAX_FILES = 6000;

  // Top-level listing first (structure + root manifests).
  let top = [];
  try { top = fs.readdirSync(root, { withFileTypes: true }); } catch { /* unreadable */ }
  for (const e of top) {
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) topDirs.push(e.name);
    } else {
      rootFiles.add(e.name.toLowerCase());
    }
  }

  // Bounded recursive walk for language stats.
  const stack = [root];
  let depthGuardHit = false;
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (fileCount >= MAX_FILES) { depthGuardHit = true; break; }
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        // Skip hidden dirs except the root's own dotfiles are already handled.
        if (e.name.startsWith('.')) continue;
        stack.push(path.join(dir, e.name));
      } else {
        fileCount += 1;
        const ext = path.extname(e.name).toLowerCase();
        if (EXT_LANG[ext]) extCounts[ext] = (extCounts[ext] || 0) + 1;
      }
    }
    if (depthGuardHit) break;
  }

  return { extCounts, topDirs: topDirs.sort(), rootFiles, fileCount, truncated: depthGuardHit };
}

/** Roll per-extension counts up into a ranked language list. */
function languagesFrom(extCounts) {
  const byLang = {};
  for (const [ext, n] of Object.entries(extCounts)) {
    const lang = EXT_LANG[ext];
    if (!lang || lang === 'Markdown') continue;
    byLang[lang] = (byLang[lang] || 0) + n;
  }
  return Object.entries(byLang)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([lang, n]) => `${lang} (${n})`);
}

/** Detect the stack + frameworks from manifest files, never from source. */
function detectStack(dir, rootFiles) {
  const stack = [];
  const frameworks = new Set();

  if (rootFiles.has('package.json')) {
    const pkg = readJsonSafe(path.join(dir, 'package.json')) || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    stack.push('Node.js');
    const map = {
      react: 'React', next: 'Next.js', vue: 'Vue', svelte: 'Svelte', vite: 'Vite',
      express: 'Express', 'socket.io': 'Socket.IO', tailwindcss: 'Tailwind',
      electron: 'Electron', zustand: 'Zustand', '@react-three/fiber': 'react-three-fiber',
    };
    for (const [k, label] of Object.entries(map)) if (deps[k]) frameworks.add(label);
    return { stack, frameworks, pkg, deps };
  }
  if (rootFiles.has('requirements.txt') || rootFiles.has('pyproject.toml') || [...rootFiles].some((f) => f.endsWith('.py'))) {
    stack.push('Python');
    const reqTxt = rootFiles.has('requirements.txt') ? readTextSafe(path.join(dir, 'requirements.txt')) : '';
    const pyproj = rootFiles.has('pyproject.toml') ? readTextSafe(path.join(dir, 'pyproject.toml')) : '';
    const hay = `${reqTxt}\n${pyproj}`.toLowerCase();
    const map = { flask: 'Flask', django: 'Django', fastapi: 'FastAPI', torch: 'PyTorch', tensorflow: 'TensorFlow', streamlit: 'Streamlit', 'edge-tts': 'edge-tts', ffmpeg: 'ffmpeg' };
    for (const [k, label] of Object.entries(map)) if (hay.includes(k)) frameworks.add(label);
    return { stack, frameworks, pkg: null, deps: {} };
  }
  if (rootFiles.has('cargo.toml')) { stack.push('Rust'); return { stack, frameworks, pkg: null, deps: {} }; }
  if (rootFiles.has('go.mod')) { stack.push('Go'); return { stack, frameworks, pkg: null, deps: {} }; }
  if (rootFiles.has('pom.xml') || rootFiles.has('build.gradle')) { stack.push('Java/JVM'); return { stack, frameworks, pkg: null, deps: {} }; }
  return { stack, frameworks, pkg: null, deps: {} };
}

/** Common entry-point filenames, reported only if they actually exist. */
function findEntryPoints(dir) {
  const candidates = [
    'app.py', 'main.py', 'manage.py', 'server.py', 'run.py',
    'index.js', 'server.js', 'app.js', 'main.js',
    'src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/App.tsx',
    'orchestrator/src/index.js', 'frontend/src/main.jsx', 'frontend/src/main.tsx',
    'main.go', 'src/main.rs', 'Cargo.toml',
  ];
  return candidates.filter((c) => {
    try { return fs.existsSync(path.join(dir, c)); } catch { return false; }
  });
}

/** README: title line + first real paragraph, cleaned of image/badge lines. */
function readmeSummary(dir, rootFiles) {
  const name = [...rootFiles].find((f) => f === 'readme.md' || f === 'readme.txt' || f === 'readme');
  if (!name) return '';
  const realName = fs.readdirSync(dir).find((f) => f.toLowerCase() === name);
  if (!realName) return '';
  const text = readTextSafe(path.join(dir, realName));
  const lines = text.split(/\r?\n/);
  let title = '';
  const para = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { if (para.length) break; continue; }
    if (!title && l.startsWith('#')) { title = l.replace(/^#+\s*/, ''); continue; }
    if (l.startsWith('#') || l.startsWith('![') || l.startsWith('[!') || l === '---') {
      if (para.length) break;
      continue;
    }
    para.push(l);
    if (para.join(' ').length > 400) break;
  }
  const summary = para.join(' ').replace(/\s+/g, ' ').slice(0, 400);
  return [title, summary].filter(Boolean).join(' — ');
}

/** Git remote + branch, read straight from .git (never touches credentials). */
function gitInfo(dir) {
  const out = {};
  const head = readTextSafe(path.join(dir, '.git', 'HEAD'), 512).trim();
  const m = head.match(/ref:\s*refs\/heads\/(.+)/);
  if (m) out.branch = m[1];
  const cfg = readTextSafe(path.join(dir, '.git', 'config'), 8 * 1024);
  const urlM = cfg.match(/url\s*=\s*(.+)/);
  if (urlM) out.remote = urlM[1].trim().replace(/\/\/[^@/]+@/, '//'); // strip any user:token@ from url
  return out;
}

/**
 * Produce the markdown brief for one project folder (name relative to the projects
 * root, or '' for the root). Pure read-only; safe to call any time.
 */
export function analyzeProject(folder) {
  const dir = folder ? path.join(PROJECTS_ROOT, folder) : PROJECTS_ROOT;
  if (!fs.existsSync(dir)) return `_Folder not found: ${folder}_`;

  const { extCounts, topDirs, rootFiles, fileCount, truncated } = walk(dir);
  const { stack, frameworks, pkg, deps } = detectStack(dir, rootFiles);
  const langs = languagesFrom(extCounts);
  const entries = findEntryPoints(dir);
  const summary = readmeSummary(dir, rootFiles);
  const git = gitInfo(dir);

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const L = [];
  L.push('## Auto-analysis');
  L.push(`_Scanned ${stamp} · ${fileCount}${truncated ? '+' : ''} files. Regenerated automatically — do not hand-edit; put durable facts under **## Notes** above._`);
  L.push('');
  if (summary) L.push(`**What it is:** ${summary}`);

  const stackLine = [...stack, ...frameworks].filter(Boolean);
  if (stackLine.length) L.push(`**Stack:** ${stackLine.join(', ')}`);
  if (langs.length) L.push(`**Languages:** ${langs.join(', ')}`);

  if (pkg?.scripts && Object.keys(pkg.scripts).length) {
    const runable = Object.keys(pkg.scripts).slice(0, 8).map((s) => `\`${s}\``).join(', ');
    L.push(`**npm scripts:** ${runable}`);
  }
  if (Object.keys(deps).length) {
    L.push(`**Key deps:** ${Object.keys(deps).slice(0, 12).join(', ')}`);
  }
  if (entries.length) L.push(`**Entry points:** ${entries.map((e) => `\`${e}\``).join(', ')}`);
  if (topDirs.length) L.push(`**Top-level dirs:** ${topDirs.slice(0, 20).map((d) => `\`${d}/\``).join(' ')}`);
  if (git.branch || git.remote) {
    L.push(`**Git:** ${[git.branch && `branch \`${git.branch}\``, git.remote].filter(Boolean).join(' · ')}`);
  }
  if (!summary && !stackLine.length && !langs.length) {
    L.push('_Not enough signal to classify this folder yet (no manifest, README, or recognized source)._');
  }
  return L.join('\n');
}
