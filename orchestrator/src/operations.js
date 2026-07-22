import { execFileSync } from 'node:child_process';
import path from 'node:path';

async function probe(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return { ok: r.ok, status: r.status }; }
  catch { return { ok: false, status: 0 }; }
}

export async function getHealth(registry, providers, mcps) {
  const [router9, stt, tts] = await Promise.all([
    probe(`${process.env.JARVIS_9ROUTER_URL || 'http://127.0.0.1:20128/v1'}/models`),
    probe('http://127.0.0.1:8000/health'), probe('http://127.0.0.1:8001/health'),
  ]);
  return { clis: registry.map((x) => ({ id: x.id, label: x.label, ok: x.available })), providers: providers.map((x) => ({ id: x.id, label: x.label, ok: true })), mcps: { ok: mcps.every((x) => x.enabled), enabled: mcps.filter((x) => x.enabled).length }, services: { router9, stt, tts } };
}

export function getReviewEvidence(root, folder = '') {
  const cwd = path.resolve(root, folder || '.');
  try {
    const status = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf8', timeout: 3000 }).trim().split(/\r?\n/).filter(Boolean);
    const diff = execFileSync('git', ['diff', '--stat'], { cwd, encoding: 'utf8', timeout: 3000 }).trim();
    return { status, diff, available: true };
  } catch (e) { return { status: [], diff: '', available: false, error: e.message }; }
}
