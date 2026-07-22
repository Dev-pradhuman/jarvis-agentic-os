/**
 * Multi-CLI registry. Detects which agent CLIs are installed and knows how to
 * invoke each one non-interactively (headless) with a chosen model + effort.
 *
 * All prompts are delivered via STDIN (robust against shell arg mangling of large
 * multi-line brain context). Effort is mapped to a native flag where the CLI has
 * one; otherwise it's injected as a hint into the prompt (see cliRunner.js).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const COMMANDS_FILE = path.join(PROJECTS_ROOT, '.jarvis-brain', 'cli-commands.json');

// Resolve a command to its absolute executable path. Returns '' if not found.
// Needed for CLIs we must spawn WITHOUT a shell (see antigravity): a bare command
// name only resolves via the shell's PATH lookup, so no-shell spawns need the path.
function resolvePath(cmd) {
  try {
    const out = execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      encoding: 'utf8',
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  } catch {
    return '';
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
    // One-click terminal command (opens a real console; edit in the CLI Commands modal).
    setupCmd: 'claude --dangerously-skip-permissions',
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
  // A separate Claude entry keeps your Claude Pro login untouched. Configure the
  // local router with ROUTER9_API_KEY (or use its dashboard key) in .env.
  router9: {
    id: 'router9',
    label: '9Router · Claude',
    cmd: 'claude',
    setupCmd: 'start http://127.0.0.1:20128/dashboard',
    nativeEffort: true,
    efforts: ['low', 'medium', 'high'],
    models: [{ id: 'kr/claude-sonnet-4.5', label: 'Claude Sonnet 4.5 via 9Router' }],
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
    setupCmd: 'opencode auth login',
    nativeEffort: false,
    efforts: ['low', 'medium', 'high'],
    // Model ids must match the user's opencode.json providers (provider/model).
    models: [
      { id: 'openrouter/openai/gpt-4o-mini', label: 'GPT-4o mini (OpenRouter)' },
    ],
    // opencode `run` is already non-interactive/autonomous; permissions follow the
    // user's opencode config. Set `"permission": {"*": "allow"}` there to fully skip.
    build(model /*, effort */) {
      const args = ['run'];
      if (model) args.push('--model', model);
      return args;
    },
  },
  // Gemini (v0.47+) reads a piped (non-TTY) stdin as the prompt and runs headless
  // on its own — so we deliver the prompt on stdin like the other shim CLIs. The
  // earlier bug was ALSO passing `-p`: Gemini then saw the stdin as a positional
  // `query` AND the -p flag and bailed ("Cannot use both a positional prompt and
  // the --prompt (-p) flag together"). Dropping -p fixes it. (It stays a shell
  // spawn: `gemini` is an npm .cmd shim, not a real .exe, so shell:false ENOENTs.)
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    cmd: 'gemini',
    setupCmd: 'gemini',
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
      return args; // prompt arrives on stdin; a piped stdin makes gemini headless
    },
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    cmd: 'codex',
    setupCmd: 'codex login',
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
  // Antigravity — command is `agy`. Its headless flag `-p/--print` takes the prompt
  // as an ARGUMENT (not stdin): `agy -p "<prompt>"`. So it sets `promptArg` (the
  // runner appends the prompt after these flags and skips stdin) and `shell: false`
  // (spawned via its resolved .EXE path, so a multi-line prompt argv isn't mangled
  // by cmd.exe). `-p` must be the LAST flag so the prompt lands as its value.
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity (agy)',
    cmd: 'agy',
    setupCmd: 'agy',
    nativeEffort: false,
    promptArg: true,
    shell: false,
    efforts: ['low', 'medium', 'high'],
    timeoutMs: 120000,
    models: [{ id: '', label: 'default' }],
    build(model /*, effort */) {
      const args = ['--dangerously-skip-permissions'];
      if (model) args.push('--model', model);
      args.push('-p'); // prompt is appended right after by the runner
      return args;
    },
  },
};

// Detect availability + resolve executable paths once at startup.
const AVAILABILITY = Object.fromEntries(
  Object.values(DEFS).map((d) => [d.id, resolvePath(d.cmd)]),
);
function isAvailable(id) {
  return !!AVAILABILITY[id];
}

// ── One-click terminal commands ────────────────────────────────────────────
// Each CLI ships a default `setupCmd` (login / launch). The user can override it
// per CLI; overrides persist to .jarvis-brain/cli-commands.json. The frontend
// opens a REAL console window running the resolved command (for interactive
// logins the captured-pipe chat path can't do).

function readSavedCommands() {
  try {
    if (fs.existsSync(COMMANDS_FILE)) return JSON.parse(fs.readFileSync(COMMANDS_FILE, 'utf8')) || {};
  } catch { /* corrupt/missing — fall back to defaults */ }
  return {};
}

/** Merged map { cliId: command } — saved overrides on top of each CLI's default. */
export function getCliCommands() {
  const saved = readSavedCommands();
  const out = {};
  for (const d of Object.values(DEFS)) out[d.id] = saved[d.id] ?? d.setupCmd ?? d.cmd;
  return out;
}

/** Resolve the terminal command for one CLI (saved override or default). */
export function getCliCommand(id) {
  const d = DEFS[id];
  if (!d) return null;
  return readSavedCommands()[id] ?? d.setupCmd ?? d.cmd;
}

/** Persist a user override for a CLI's terminal command. Empty string resets to default. */
export function setCliCommand(id, command) {
  if (!DEFS[id]) throw new Error(`Unknown CLI ${id}`);
  const saved = readSavedCommands();
  if (command && command.trim()) saved[id] = command.trim();
  else delete saved[id]; // reset to default
  fs.mkdirSync(path.dirname(COMMANDS_FILE), { recursive: true });
  fs.writeFileSync(COMMANDS_FILE, JSON.stringify(saved, null, 2));
  return getCliCommands();
}

/** Public registry for the frontend selector. */
export function getRegistry() {
  const cmds = getCliCommands();
  return Object.values(DEFS).map((d) => ({
    id: d.id,
    label: d.label,
    available: isAvailable(d.id),
    nativeEffort: d.nativeEffort,
    efforts: d.efforts,
    models: d.models,
    setupCmd: cmds[d.id],
  }));
}

export function getCli(id) {
  const d = DEFS[id];
  if (!d) return null;
  return { ...d, available: isAvailable(id), resolvedPath: AVAILABILITY[id] };
}
