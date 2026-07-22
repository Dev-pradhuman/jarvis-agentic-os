/**
 * Claude Code plugin parity — makes the plugins Claude Code ships usable by EVERY
 * CLI and API provider, not just Claude.
 *
 * A Claude Code plugin (under ~/.claude/plugins/marketplaces/<mp>/plugins/<name>/
 * or .../external_plugins/<name>/) bundles, all optional:
 *   .claude-plugin/plugin.json   manifest (name, description)
 *   .mcp.json                    MCP servers  → materialized into the shared MCP
 *                                registry (mcp.js), which syncs to every CLI's
 *                                native config AND bridges into API providers.
 *   skills/<name>/SKILL.md       skills       → copied into the Jarvis skills store
 *   commands/*.md                slash cmds   → copied as skills (they're prompts)
 *   agents/*.md                  subagents    → copied as skills (portable as prompts)
 *
 * Activating a plugin fans its parts into those shared systems; deactivating reverses
 * exactly what it added (tracked in the plugins.js registry under `added`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addMcp, removeMcp } from './mcp.js';
import { saveSkill, deleteSkill } from './skillsManager.js';
import { listPlugins, addPlugin, removePlugin, setEnabled as setPluginEnabled } from './plugins.js';

const HOME = os.homedir();
const MARKETPLACES = path.join(HOME, '.claude', 'plugins', 'marketplaces');
// Your own plugins live here, in the SAME format as a Claude Code plugin, so they
// activate through the identical path and reach every CLI + API provider.
const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const LOCAL_PLUGINS = path.join(PROJECTS_ROOT, '.jarvis-brain', 'plugins');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function safeId(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function listDirs(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return []; }
}
function listFiles(p, ext) {
  try { return fs.readdirSync(p).filter((f) => f.toLowerCase().endsWith(ext)); }
  catch { return []; }
}

/** Normalize a plugin's .mcp.json into [{name, command, args, env, url, transport}]. */
function parseMcp(dir) {
  const raw = readJson(path.join(dir, '.mcp.json'));
  if (!raw) return [];
  const servers = raw.mcpServers || raw; // support both shapes
  const out = [];
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') continue;
    out.push({
      name,
      command: cfg.command || '',
      args: Array.isArray(cfg.args) ? cfg.args : [],
      env: cfg.env || {},
      url: cfg.url || cfg.httpUrl || '',
      transport: cfg.url || cfg.httpUrl ? 'http' : 'stdio',
    });
  }
  return out;
}

/** Inventory one plugin directory into a descriptor. */
function inspectPlugin(baseDir, name, marketplace) {
  const dir = path.join(baseDir, name);
  const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json')) || {};
  const mcps = parseMcp(dir);
  const skills = listDirs(path.join(dir, 'skills')).filter((s) =>
    fs.existsSync(path.join(dir, 'skills', s, 'SKILL.md')),
  );
  const commands = listFiles(path.join(dir, 'commands'), '.md');
  const agents = listFiles(path.join(dir, 'agents'), '.md');
  return {
    id: safeId(manifest.name || name),
    label: manifest.name || name,
    description: manifest.description || '',
    marketplace,
    dir,
    counts: { mcps: mcps.length, skills: skills.length, commands: commands.length, agents: agents.length },
  };
}

/**
 * Every plugin discoverable across the Claude marketplaces AND your own local
 * plugins in .jarvis-brain/plugins. Local ones win on id collision (they're yours).
 */
export function scanClaudePlugins() {
  const found = [];
  // Yours first — they take precedence in the de-dupe below.
  for (const name of listDirs(LOCAL_PLUGINS)) {
    if (name.startsWith('.')) continue;
    try { found.push({ ...inspectPlugin(LOCAL_PLUGINS, name, 'local'), local: true }); } catch { /* skip */ }
  }
  for (const mp of listDirs(MARKETPLACES)) {
    for (const sub of ['plugins', 'external_plugins']) {
      const base = path.join(MARKETPLACES, mp, sub);
      for (const name of listDirs(base)) {
        if (name.startsWith('.')) continue;
        try { found.push(inspectPlugin(base, name, mp)); } catch { /* skip malformed */ }
      }
    }
  }
  // De-dupe by id (a plugin can appear under plugins/ and external_plugins/).
  const byId = new Map();
  for (const p of found) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Merge discovered plugins with their activated state (from the plugins.js registry). */
export function listClaudePlugins(folder) {
  const activated = new Map(listPlugins(folder).filter((p) => p.source === 'claude-code').map((p) => [p.id, p]));
  return scanClaudePlugins().map((p) => {
    const rec = activated.get(p.id);
    return { ...p, activated: !!rec, enabled: rec ? rec.enabled : false, added: rec?.added || null };
  });
}

/**
 * Activate a plugin for `folder` (''=global): fan its MCPs + skills/commands/agents
 * into the shared systems, and record what was added so it can be reversed.
 */
export function activateClaudePlugin(id, folder) {
  const plugin = scanClaudePlugins().find((p) => p.id === id);
  if (!plugin) throw new Error(`Claude plugin '${id}' not found`);
  const added = { mcps: [], skills: [] };

  // 1) MCP servers → shared registry (syncs to all CLIs + bridges to APIs).
  for (const m of parseMcp(plugin.dir)) {
    if (m.transport === 'stdio' && !m.command) continue;
    addMcp({ name: m.name, command: m.command, args: m.args, env: m.env, url: m.url, transport: m.transport, enabled: true }, folder);
    added.mcps.push(safeId(m.name));
  }

  // 2) skills/<name>/SKILL.md → Jarvis skills
  const skillsDir = path.join(plugin.dir, 'skills');
  for (const s of listDirs(skillsDir)) {
    const md = path.join(skillsDir, s, 'SKILL.md');
    if (!fs.existsSync(md)) continue;
    const skillId = `PLUGIN_${safeId(plugin.id)}_${safeId(s)}`.toUpperCase();
    saveSkill(skillId, fs.readFileSync(md, 'utf8'), folder);
    added.skills.push(skillId);
  }

  // 3) commands/*.md and agents/*.md → skills (portable prompt content)
  for (const [subdir, prefix] of [['commands', 'CMD'], ['agents', 'AGENT']]) {
    const d = path.join(plugin.dir, subdir);
    for (const f of listFiles(d, '.md')) {
      const skillId = `${prefix}_${safeId(plugin.id)}_${safeId(f.replace(/\.md$/i, ''))}`.toUpperCase();
      saveSkill(skillId, fs.readFileSync(path.join(d, f), 'utf8'), folder);
      added.skills.push(skillId);
    }
  }

  // Track activation in the plugins registry (drives enable/disable + reversal).
  addPlugin({ name: plugin.id, label: plugin.label, description: plugin.description, source: 'claude-code', added, enabled: true }, folder);
  return { id: plugin.id, added };
}

/** Reverse an activation: remove exactly the MCPs + skills it added. */
export function deactivateClaudePlugin(id, folder) {
  const rec = listPlugins(folder).find((p) => p.id === id && p.source === 'claude-code');
  const added = rec?.added || { mcps: [], skills: [] };
  for (const mcpId of added.mcps || []) { try { removeMcp(mcpId, folder); } catch { /* gone */ } }
  for (const skillId of added.skills || []) { try { deleteSkill(skillId, folder); } catch { /* gone */ } }
  removePlugin(id, folder);
  return { id, removed: { mcps: (added.mcps || []).length, skills: (added.skills || []).length } };
}

/** Enable/disable an already-activated plugin (per folder) without re-materializing. */
export function toggleClaudePlugin(id, enabled, folder) {
  setPluginEnabled(id, enabled, folder);
  return { id, enabled: !!enabled };
}

/**
 * Scaffold one of YOUR OWN plugins in .jarvis-brain/plugins/<name>/, in the exact
 * Claude Code plugin layout — so activating it fans your skills/commands/MCPs to
 * every CLI + API through the same path the official plugins use. Edit the files,
 * then hit Activate.
 */
export function scaffoldLocalPlugin(name) {
  const id = safeId(name);
  if (!id) throw new Error('plugin needs a name');
  const dir = path.join(LOCAL_PLUGINS, id);
  if (fs.existsSync(dir)) throw new Error(`plugin '${id}' already exists`);

  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills', 'example'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'commands'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: id, description: `${name} — my plugin`, author: { name: 'me' } }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'skills', 'example', 'SKILL.md'),
    `# ${name} — example skill\n\nDescribe what this skill does and the steps an agent should follow.\nEvery CLI and API provider gets this once the plugin is activated.\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'commands', `${id}.md`),
    `# /${id}\n\nWhat this command should do. Commands are just prompts, so they port to\nevery agent, not only Claude.\n`,
  );
  // A .mcp.json is optional — drop servers in here and they sync to every CLI.
  fs.writeFileSync(
    path.join(dir, '.mcp.json'),
    JSON.stringify({}, null, 2),
  );

  return { id, dir };
}

/** Where your own plugins live (surfaced in the UI so you can go edit them). */
export function localPluginsDir() {
  return LOCAL_PLUGINS;
}
