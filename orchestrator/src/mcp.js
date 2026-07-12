/**
 * Central MCP registry — one place to import Model Context Protocol servers that
 * every agent shares. Jarvis stores them in the brain, then GENERATES each CLI's
 * native MCP config so Claude Code, Codex, Gemini, and OpenCode all load them.
 * For API providers the orchestrator bridges tools at runtime (see providers.js).
 *
 * Registry file: {projectsRoot}/.jarvis-brain/mcp.json
 * Each server: { id, name, transport:'stdio'|'http', command, args[], env{}, url, enabled }
 *
 * Sync MERGES into existing configs — it never removes servers Jarvis doesn't own
 * (e.g. Gemini's filesystem, Codex's node_repl are preserved). Ownership is tracked
 * by name in the registry, so remove() only deletes those keys.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const STORE = path.join(PROJECTS_ROOT, '.jarvis-brain', 'mcp.json');
const HOME = os.homedir();

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return [];
  }
}
function save(list) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(list, null, 2));
}
function slugify(s) {
  return String(s || 'mcp').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function listMcp() {
  return load();
}

/**
 * Import an MCP server. Accepts either a stdio command line or an HTTP/SSE URL.
 * @param {{name, command?, args?, env?, url?, transport?}} spec
 */
export function addMcp(spec) {
  const list = load();
  const transport = spec.transport || (spec.url ? 'http' : 'stdio');
  const id = slugify(spec.name || spec.command || spec.url);
  const server = {
    id,
    name: slugify(spec.name || id), // config key (must be a safe identifier)
    label: spec.name || id,
    transport,
    command: spec.command || '',
    args: Array.isArray(spec.args) ? spec.args : parseArgs(spec.args),
    env: spec.env || {},
    url: spec.url || '',
    enabled: spec.enabled !== false,
  };
  const next = list.filter((s) => s.id !== id);
  next.push(server);
  save(next);
  const report = syncAll();
  return { server, sync: report };
}

export function removeMcp(id) {
  const list = load();
  const server = list.find((s) => s.id === id);
  save(list.filter((s) => s.id !== id));
  // Remove this server's key from every CLI config we manage.
  if (server) purgeFromClis(server.name);
  return { removed: !!server, sync: syncAll() };
}

export function setEnabled(id, enabled) {
  const list = load();
  const s = list.find((x) => x.id === id);
  if (s) s.enabled = enabled;
  save(list);
  return { sync: syncAll() };
}

function parseArgs(str) {
  if (!str) return [];
  // naive shell split respecting quotes
  return (String(str).match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
}

// ── Native config generators ────────────────────────────────────────────────

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

const CLAUDE_CFG = path.join(HOME, '.claude.json');
const GEMINI_CFG = path.join(HOME, '.gemini', 'settings.json');
const OPENCODE_CFG = path.join(HOME, '.config', 'opencode', 'opencode.json');
const CODEX_CFG = path.join(HOME, '.codex', 'config.toml');

const enabledServers = () => load().filter((s) => s.enabled);

/** Claude Code + Gemini share {command,args,env} / {httpUrl|type:http}. */
function syncClaude() {
  const cfg = readJson(CLAUDE_CFG);
  cfg.mcpServers = cfg.mcpServers || {};
  // drop our old entries, re-add
  for (const s of load()) delete cfg.mcpServers[s.name];
  for (const s of enabledServers()) {
    cfg.mcpServers[s.name] =
      s.transport === 'http'
        ? { type: 'http', url: s.url }
        : { command: s.command, args: s.args, env: s.env };
  }
  writeJson(CLAUDE_CFG, cfg);
  return CLAUDE_CFG;
}

function syncGemini() {
  const cfg = readJson(GEMINI_CFG);
  cfg.mcpServers = cfg.mcpServers || {};
  for (const s of load()) delete cfg.mcpServers[s.name];
  for (const s of enabledServers()) {
    cfg.mcpServers[s.name] =
      s.transport === 'http'
        ? { httpUrl: s.url }
        : { command: s.command, args: s.args, env: s.env };
  }
  writeJson(GEMINI_CFG, cfg);
  return GEMINI_CFG;
}

function syncOpenCode() {
  const cfg = readJson(OPENCODE_CFG);
  cfg.$schema = cfg.$schema || 'https://opencode.ai/config.json';
  cfg.mcp = cfg.mcp || {};
  for (const s of load()) delete cfg.mcp[s.name];
  for (const s of enabledServers()) {
    cfg.mcp[s.name] =
      s.transport === 'http'
        ? { type: 'remote', url: s.url, enabled: true }
        : { type: 'local', command: [s.command, ...s.args], enabled: true, environment: s.env };
  }
  writeJson(OPENCODE_CFG, cfg);
  return OPENCODE_CFG;
}

/** Codex is TOML — do a marked-block merge so existing servers are preserved. */
function syncCodex() {
  let text = '';
  try {
    text = fs.readFileSync(CODEX_CFG, 'utf8');
  } catch {
    text = '';
  }
  const START = '# >>> jarvis-managed mcp (do not edit) >>>';
  const END = '# <<< jarvis-managed mcp <<<';
  // strip previous managed block
  const re = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, 'g');
  text = text.replace(re, '');

  const blocks = enabledServers()
    .filter((s) => s.transport === 'stdio') // codex mcp = stdio
    .map((s) => {
      const args = JSON.stringify(s.args);
      let b = `\n[mcp_servers.${s.name}]\ncommand = ${JSON.stringify(s.command)}\nargs = ${args}\n`;
      const envKeys = Object.keys(s.env || {});
      if (envKeys.length) {
        b += `[mcp_servers.${s.name}.env]\n`;
        for (const k of envKeys) b += `${k} = ${JSON.stringify(s.env[k])}\n`;
      }
      return b;
    })
    .join('');

  const managed = blocks ? `\n${START}${blocks}${END}\n` : '';
  fs.mkdirSync(path.dirname(CODEX_CFG), { recursive: true });
  fs.writeFileSync(CODEX_CFG, text.trimEnd() + '\n' + managed);
  return CODEX_CFG;
}

/** Remove a server key from every managed config (used on delete). */
function purgeFromClis(name) {
  for (const [p, key] of [
    [CLAUDE_CFG, 'mcpServers'],
    [GEMINI_CFG, 'mcpServers'],
    [OPENCODE_CFG, 'mcp'],
  ]) {
    const cfg = readJson(p);
    if (cfg[key] && cfg[key][name]) {
      delete cfg[key][name];
      writeJson(p, cfg);
    }
  }
  syncCodex(); // rewrites managed block without the removed server
}

/** Regenerate every CLI's config from the registry. */
export function syncAll() {
  const out = {};
  try { out.claude = syncClaude(); } catch (e) { out.claudeError = e.message; }
  try { out.gemini = syncGemini(); } catch (e) { out.geminiError = e.message; }
  try { out.opencode = syncOpenCode(); } catch (e) { out.opencodeError = e.message; }
  try { out.codex = syncCodex(); } catch (e) { out.codexError = e.message; }
  return out;
}

/** Enabled servers, for the API tool-bridge + brain awareness. */
export function enabledForBridge() {
  return enabledServers();
}

/** One-line catalog string for injecting into the brain context. */
export function mcpCatalog() {
  const s = enabledServers();
  if (!s.length) return '';
  return s.map((x) => `- ${x.name} (${x.transport}${x.url ? ' ' + x.url : ' ' + x.command})`).join('\n');
}
