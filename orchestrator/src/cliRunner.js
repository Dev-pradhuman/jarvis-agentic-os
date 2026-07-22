/**
 * Spawns a real agent CLI on the machine, feeds it the brain-augmented prompt via
 * stdin, and streams stdout back. Runs in the selected project folder as cwd, so
 * the agent acts on the right project. Hard timeout guards against runaway agents.
 */

import { exec, spawn } from 'node:child_process';

const TIMEOUT_MS = Number(process.env.JARVIS_CLI_TIMEOUT_MS || 240000);

/**
 * Kill a spawned process AND its children. On Windows a shell:true spawn makes
 * proc.pid the cmd wrapper, so SIGKILL alone can orphan the real CLI — taskkill /T
 * tears down the whole tree. Used by the Stop / kill-switch controls.
 */
export function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') {
    try {
      exec(`taskkill /pid ${proc.pid} /T /F`);
    } catch {
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
    }
  } else {
    try { proc.kill('SIGKILL'); } catch { /* gone */ }
  }
}

/**
 * @param {object} cli     entry from cli.js getCli()
 * @param {string} model
 * @param {string} effort
 * @param {string} cwd     absolute path of the project folder to run in
 * @param {string} prompt  brain-augmented prompt (delivered on stdin)
 * @param {(chunk:string)=>void} onChunk streamed stdout/stderr
 * @returns {Promise<{status:'success'|'error', code:number, output:string}>}
 */
export function runCli(cli, model, effort, cwd, prompt, onChunk = () => {}, onChild = () => {}) {
  const args = cli.build(model, effort);
  const timeout = cli.timeoutMs || TIMEOUT_MS;
  // Inject an effort hint for CLIs without a native effort flag.
  const input = !cli.nativeEffort && effort ? `Reasoning effort: ${effort}.\n\n${prompt}` : prompt;

  // Some CLIs (e.g. antigravity/agy) take the prompt as a trailing ARGUMENT instead
  // of on stdin. Append it after the built flags and skip the stdin write.
  const promptViaArg = !!cli.promptArg;
  if (promptViaArg) args.push(input);

  // shell:true is required on Windows for the npm `.cmd` shim CLIs, but it re-parses
  // args through cmd.exe (which mangles a multi-line prompt argv). CLIs that pass the
  // prompt as an arg opt out of the shell and spawn via their resolved .EXE path.
  const useShell = cli.shell === false ? false : process.platform === 'win32';
  const command = !useShell && cli.resolvedPath ? cli.resolvedPath : cli.cmd;

  return new Promise((resolve) => {
    let proc;
    try {
      const env = { ...process.env };
      // Router is deliberately opt-in: normal Claude Code keeps the user's Pro auth.
      if (cli.id === 'router9') {
        env.ANTHROPIC_BASE_URL = process.env.JARVIS_9ROUTER_URL || 'http://127.0.0.1:20128/v1';
        env.ANTHROPIC_API_KEY = process.env.ROUTER9_API_KEY || process.env.JARVIS_9ROUTER_API_KEY || 'sk_9router';
      }

      proc = spawn(command, args, { cwd, shell: useShell, env });
    } catch (e) {
      resolve({ status: 'error', code: -1, output: `spawn failed: ${e.message}` });
      return;
    }
    onChild(proc); // hand the child to the caller so it can be stopped/killed

    let output = '';
    let settled = false;

    const killTimer = setTimeout(() => {
      if (!settled) {
        onChunk(`\n[jarvis] TIMEOUT after ${timeout}ms — killing ${cli.id}.\n`);
        proc.kill('SIGKILL');
      }
    }, timeout);

    if (!promptViaArg) {
      try {
        proc.stdin?.write(input);
        proc.stdin?.end();
      } catch {
        /* stdin may be closed already */
      }
    } else {
      try { proc.stdin?.end(); } catch { /* no stdin needed */ }
    }

    proc.stdout?.on('data', (d) => {
      const c = d.toString();
      output += c;
      onChunk(c);
    });
    proc.stderr?.on('data', (d) => {
      const c = d.toString();
      output += c;
      onChunk(c);
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ status: 'error', code: -1, output: `${output}\n${err.message}` });
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ status: code === 0 ? 'success' : 'error', code: code ?? -1, output });
    });
  });
}
