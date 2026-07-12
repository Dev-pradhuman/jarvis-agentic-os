/**
 * Multi-CLI registry. Detects which agent CLIs are installed and knows how to
 * invoke each one non-interactively (headless) with a chosen model + effort.
 *
 * All prompts are delivered via STDIN (robust against shell arg mangling of large
 * multi-line brain context). Effort is mapped to a native flag where the CLI has
 * one; otherwise it's injected as a hint into the prompt (see cliRunner.js).
 */

import { execSync } from 'node:child_process';

function isInstalled(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

// Each entry: how to turn (model, effort) into a spawn. The prompt always arrives
// on stdin, so `args` carries only flags. `nativeEffort` = the CLI has an effort
// flag; otherwise the runner injects an effort hint into the prompt text.
// NOTE: every CLI runs in "dangerously skip permissions" mode per the user's
// request — the agent auto-approves file edits and shell commands in the chosen
// project folder. The hard timeout in cliRunner remains the only guardrail.
const DEFS = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    cmd: 'claude',
    nativeEffort: true,
    efforts: ['low', 'medium', 'high'],
    models: [
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ],
    build(model, effort) {
      const args = ['-p', '--dangerously-skip-permissions'];
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      return args;
    },
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    cmd: 'opencode',
    nativeEffort: false,
    efforts: ['low', 'medium', 'high'],
    models: [
      { id: 'opencode/claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'opencode/claude-haiku-4-5', label: 'Haiku 4.5' },
      { id: 'opencode/big-pickle', label: 'Big Pickle' },
    ],
    // opencode `run` is already non-interactive/autonomous; permissions follow the
    // user's opencode config. Set `"permission": {"*": "allow"}` there to fully skip.
    build(model /*, effort */) {
      const args = ['run'];
      if (model) args.push('--model', model);
      return args;
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    cmd: 'gemini',
    nativeEffort: false,
    efforts: ['low', 'medium', 'high'],
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    build(model /*, effort */) {
      // yolo = auto-approve ALL tools (the "dangerously skip permissions" mode).
      const args = ['--approval-mode', 'yolo'];
      if (model) args.push('-m', model);
      args.push('-p', 'Follow the instructions provided on standard input.');
      return args;
    },
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    cmd: 'codex',
    nativeEffort: true,
    efforts: ['low', 'medium', 'high'],
    models: [
      { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'o3', label: 'o3' },
    ],
    build(model, effort) {
      const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check'];
      if (model) args.push('-c', `model="${model}"`);
      if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
      args.push('-'); // read the prompt from stdin
      return args;
    },
  },
  // Antigravity — command is `agy`. It appears to be interactive/GUI-oriented, so
  // headless behavior is best-effort with a short timeout; adjust `build` once its
  // non-interactive syntax is known. `dangerousArgs` left empty (flag unknown).
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity (agy)',
    cmd: 'agy',
    nativeEffort: false,
    efforts: ['low', 'medium', 'high'],
    timeoutMs: 45000,
    models: [{ id: '', label: 'default' }],
    build(/* model, effort */) {
      return ['-p'];
    },
  },
};

// Detect availability once at startup.
const AVAILABILITY = Object.fromEntries(
  Object.values(DEFS).map((d) => [d.id, isInstalled(d.cmd)]),
);

/** Public registry for the frontend selector. */
export function getRegistry() {
  return Object.values(DEFS).map((d) => ({
    id: d.id,
    label: d.label,
    available: AVAILABILITY[d.id],
    nativeEffort: d.nativeEffort,
    efforts: d.efforts,
    models: d.models,
  }));
}

export function getCli(id) {
  const d = DEFS[id];
  if (!d) return null;
  return { ...d, available: AVAILABILITY[id] };
}
