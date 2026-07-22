import fs from 'node:fs';
import path from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', '.svelte-kit', 'out', 'target', 'vendor', '.cache', 'coverage',
  '.obsidian', '.playwright-mcp', 'graphify-out', '.idea', '.vscode', 'site-packages',
]);

const cache = new Map();

const TEXT_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.py', '.html',
  '.css', '.txt', '.sh', '.yml', '.yaml', '.toml', '.env', '.ini', '.c', '.cpp',
  '.h', '.java', '.go', '.rs', '.sql', '.xml', '.svelte', '.vue'
]);

const TEXT_NAMES = new Set(['Dockerfile', 'Makefile', 'LICENSE']);

export function getProjectStats(rootPath) {
  const now = Date.now();
  if (cache.has(rootPath)) {
    const cached = cache.get(rootPath);
    if (now - cached.timestamp < 30000) return cached.stats;
  }

  let totalBytes = 0;
  let tokenBytes = 0;
  let fileCount = 0;
  let dirCount = 0;

  const stack = [rootPath];
  let depthGuardHit = false;

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (fileCount > 10000) { depthGuardHit = true; break; }
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(path.join(dir, e.name));
        dirCount++;
      } else {
        fileCount++;
        try {
          const size = fs.statSync(path.join(dir, e.name)).size;
          totalBytes += size;
          const ext = path.extname(e.name).toLowerCase();
          if (TEXT_EXTS.has(ext) || TEXT_NAMES.has(e.name)) {
            tokenBytes += size;
          }
        } catch {}
      }
    }
    if (depthGuardHit) break;
  }

  const estTokens = Math.round(tokenBytes / 4);
  const sizeMb = (totalBytes / (1024 * 1024)).toFixed(2);
  
  const stats = {
    totalBytes,
    sizeMb,
    fileCount,
    estTokens,
    truncated: depthGuardHit
  };

  cache.set(rootPath, { timestamp: now, stats });
  return stats;
}
