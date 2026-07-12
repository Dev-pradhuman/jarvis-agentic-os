/**
 * Skill execution wrapper — turns a resolved intent into a headless Claude Code run.
 *
 * Guardrails (Section 5.4):
 *   - HARD TIMEOUT on every spawn. If Claude Code spins past the budget we KILL it,
 *     preventing infinite agentic loops.
 *   - stdout is streamed line-by-line so the caller can pipe it to the frontend
 *     Live Terminal Feed over WebSockets.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.JARVIS_VAULT
  ? path.resolve(__dirname, '..', process.env.JARVIS_VAULT)
  : path.resolve(__dirname, '../../vault/Jarvis_Vault');
const TIMEOUT_MS = Number(process.env.JARVIS_SKILL_TIMEOUT_MS || 60000);

/** Load a skill SOP and interpolate runtime context into its placeholders. */
function buildPrompt(sopFile, runtimeContext) {
  const sopPath = path.join(VAULT, '99_System', 'Skills', sopFile);
  const template = fs.readFileSync(sopPath, 'utf8');
  return template
    .replaceAll('{{DATE}}', new Date().toISOString())
    .replaceAll('{{CONTEXT}}', JSON.stringify(runtimeContext ?? {}))
    .replaceAll('{{CONTEXT.topic}}', runtimeContext?.topic ?? '');
}

/**
 * Run a skill via headless Claude Code (`claude -p`), streaming stdout.
 *
 * @param {string} sopFile        SOP filename in 99_System/Skills
 * @param {object} runtimeContext parameters extracted by the router
 * @param {(line: string) => void} onLog  called for each stdout chunk
 * @returns {Promise<{status:'success'|'error', code:number, output:string}>}
 */
export function runSkill(sopFile, runtimeContext, onLog = () => {}, onChild = () => {}) {
  const prompt = buildPrompt(sopFile, runtimeContext);

  return new Promise((resolve) => {
    // -p runs non-interactively and exits. The prompt is fed via STDIN rather than
    // argv: a large multi-line prompt passed as a shell argument breaks under the
    // Windows shell (newlines/quotes terminate the command line).
    const proc = spawn('claude', ['-p'], {
      cwd: VAULT,
      shell: process.platform === 'win32', // resolve claude.cmd/.exe on Windows
    });
    onChild(proc);

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    let output = '';
    let settled = false;

    const killTimer = setTimeout(() => {
      if (!settled) {
        onLog(`\n[jarvis] TIMEOUT after ${TIMEOUT_MS}ms — killing runaway process.\n`);
        proc.kill('SIGKILL');
      }
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => {
      const chunk = d.toString();
      output += chunk;
      onLog(chunk);
    });
    proc.stderr.on('data', (d) => onLog(d.toString()));

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ status: 'error', code: -1, output: `${output}\n${err.message}`, promptChars: prompt.length });
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ status: code === 0 ? 'success' : 'error', code: code ?? -1, output, promptChars: prompt.length });
    });
  });
}
