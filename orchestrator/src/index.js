/**
 * Jarvis Orchestrator — WebSocket hub + HTTP surface.
 *
 * Flow: frontend sends a transcript over WS -> router resolves an intent ->
 * skillRunner spawns headless Claude Code -> stdout + SkillStateUpdate events
 * stream back to the frontend Live Terminal Feed and progress cards.
 *
 * Also broadcasts a live `state_update` (real vitals, documents, directives,
 * calendar, token usage) to all clients on an interval.
 */

import './env.js';
import fs from 'node:fs';
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import os from 'node:os';
import pty from 'node-pty';

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  fs.writeFileSync('crash.log', String(err.stack || err) + '\n', { flag: 'a' });
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
  fs.writeFileSync('crash.log', String(err.stack || err) + '\n', { flag: 'a' });
});

import { route } from './router.js';
import { runSkill } from './skillRunner.js';
import { SKILLS, UI_INTENTS } from './skills.js';
import { getState, recordTokens, sampleTokens, getProjectDashboard } from './state.js';
import { getCli, getRegistry, getCliCommand, getCliCommands, setCliCommand } from './cli.js';
import { spawn } from 'node:child_process';
import { killProcessTree, runCli } from './cliRunner.js';
import { addProvider, API_TYPES, listProviders, modelsForProvider, removeProvider, runApiChat, updateProvider } from './providers.js';
import { getProjectStats } from './projectStats.js';
import { addMcp, listMcp, removeMcp, setEnabled as setMcpEnabled, syncAll } from './mcp.js';
import { listPlugins, addPlugin, removePlugin, setEnabled as setPluginEnabled } from './plugins.js';
import { listClaudePlugins, activateClaudePlugin, deactivateClaudePlugin, toggleClaudePlugin, scaffoldLocalPlugin, localPluginsDir } from './claudePlugins.js';
import { getRoles, setRole } from './roles.js';
import { isRuflowEnabled, setRuflowEnabled, getRuflowState, writeMemoryBank } from './ruflow.js';
import { seedBest, seedExtras, getCatalog } from './catalog.js';
import { enhancePrompt } from './promptEnhancer.js';
import { analyzeFolder, appendChat, appendNote, ensureBrain, generateAllSubBrains, getContext, listChats, listFolders, ROOT, searchBrain, VAULT_PATH } from './brain.js';
import { deleteSkill, isSkillEnabled, listSkills, readSkill, saveSkill, setSkillEnabled } from './skillsManager.js';
import { getUsage } from './usage.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localOrigins, projectPath } from './security.js';
import { getHealth, getReviewEvidence } from './operations.js';
import { decideApproval, listApprovals, requestApproval } from './approvals.js';
import { ROUTING_PROFILES, completeMissionStage, createMission, getMission, listMissions, updateMission } from './missions.js';
import { capabilityAudit } from './capabilities.js';
import { saveSetup, setupStatus } from './setup.js';

const PORT = Number(process.env.PORT || 3030);
const HOST = process.env.JARVIS_HOST || '127.0.0.1';
const ALLOWED_ORIGINS = localOrigins();

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'orchestrator' }));
app.get('/setup/status', (_req, res) => res.json(setupStatus()));
app.post('/setup', (req, res) => { try { res.json(saveSetup(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/skills', (_req, res) => res.json(Object.values(SKILLS)));
app.get('/state', (_req, res) => res.json(getState(running)));
app.get('/clis', (_req, res) => res.json(getRegistry()));
app.get('/folders', (_req, res) => res.json({ root: ROOT, vault: VAULT_PATH, folders: listFolders() }));
app.get('/project-stats', (req, res) => {
  const folder = req.query.folder;
  if (!folder) return res.json(null);
  let fullPath;
  try { fullPath = projectPath(ROOT, folder); } catch { return res.status(400).json({ error: 'Invalid folder' }); }
  res.json({
    ...getProjectStats(fullPath),
    dashboard: getProjectDashboard(folder)
  });
});
app.get('/providers', (_req, res) => res.json(listProviders()));
app.get('/provider-types', (_req, res) => res.json(API_TYPES));
app.get('/skills-manage', (_req, res) => res.json(listSkills()));
app.get('/usage', (_req, res) => res.json(getUsage(running)));
app.get('/search', (req, res) => res.json({ query: req.query.q || '', results: searchBrain(req.query.q || '') }));
app.get('/mcp', (_req, res) => res.json(listMcp()));
app.get('/operations/approvals', (_req, res) => res.json(listApprovals()));
app.get('/operations/missions', (req, res) => res.json(listMissions(req.query.folder || '')));
app.get('/operations/routing', (_req, res) => res.json(ROUTING_PROFILES));
app.get('/operations/capabilities', (req, res) => res.json(capabilityAudit(req.query.folder || '')));
app.get('/operations/health', async (_req, res) => res.json(await getHealth(getRegistry(), listProviders(), listMcp())));
app.get('/operations/review', (req, res) => { try { res.json(getReviewEvidence(ROOT, req.query.folder || '')); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/mcp', (req, res) => {
  try {
    const result = addMcp(req.body || {});
    io.emit('mcp_list', listMcp());
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/providers', async (req, res) => {
  try {
    const result = await addProvider(req.body || {});
    io.emit('provider_list', listProviders());
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

ensureBrain();
{
  const { total, created } = generateAllSubBrains();
  console.log(`[brain] ${total} sub-brains ready (${created.length} newly created)`);
}
// Push the MCP registry into every CLI's native config at boot.
try {
  syncAll();
  console.log(`[mcp] synced ${listMcp().length} server(s) to CLI configs`);
} catch (e) {
  console.log('[mcp] sync failed:', e.message);
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS } });

let running = 0; // skills + chats currently executing (drives the AGENTS vital)

// ── Active-run registry — lets Stop / kill-switch halt in-flight work ──
const activeRuns = new Map(); // chatId -> { kind:'proc'|'api', proc?, controller?, cliId }
const taskBoard = new Map(); // concise task declarations injected into sibling runs

function coordinationContext(exceptId) {
  const active = [...taskBoard.entries()].filter(([id]) => id !== exceptId).map(([, task]) =>
    `- ${task.cli} on ${task.folder || 'root'}: ${task.prompt}`);
  return active.length ? `\n\n===== ACTIVE AGENT COORDINATION =====\nOther agents are currently working on:\n${active.join('\n')}\nAvoid duplicating their work; review or extend it instead.\n===== END ACTIVE COORDINATION =====` : '';
}

function broadcastTaskBoard() { io.emit('agent_activity', [...taskBoard.values()]); }
const activeSkillProcs = new Map(); // skillRunId -> child process
const stoppedIds = new Set(); // ids the user explicitly stopped (→ status 'stopped')

/** Stop one chat run: kill its process tree (CLI) or abort its fetch (API). */
function stopRun(chatId) {
  const r = activeRuns.get(chatId);
  if (!r) return false;
  stoppedIds.add(chatId);
  if (r.kind === 'proc') killProcessTree(r.proc);
  else r.controller?.abort();
  return true;
}

/** Emergency stop: halt every running chat + skill. */
function stopAll() {
  let n = 0;
  for (const id of [...activeRuns.keys()]) if (stopRun(id)) n += 1;
  for (const [sid, proc] of activeSkillProcs) {
    stoppedIds.add(sid);
    killProcessTree(proc);
    n += 1;
  }
  return n;
}

/**
 * Open a REAL, visible terminal window running `command`, kept open afterwards so
 * interactive flows (e.g. `codex login`, a CLI's device-auth prompt) work — the
 * captured-pipe chat path can't do that. Runs in the selected project folder.
 * Windows: `cmd /c start "<title>" cmd /k "<command>"`. POSIX best-effort fallback.
 */
function openTerminal(command, cwd, title = 'Jarvis') {
  if (!command || !command.trim()) throw new Error('empty command');
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', title, 'cmd', '/k', command], {
      cwd,
      windowsHide: false,
      detached: true,
    });
    child.on('error', () => {});
    child.unref();
  } else {
    // Best-effort: try a few common terminals, then fall back to a detached shell.
    const term = process.env.TERMINAL || 'x-terminal-emulator';
    try {
      const child = spawn(term, ['-e', `bash -lc '${command}; exec bash'`], { cwd, detached: true });
      child.on('error', () => {});
      child.unref();
    } catch {
      spawn('bash', ['-lc', command], { cwd, detached: true }).unref();
    }
  }
}

const TRANSIENT_RE = /timeout|econnreset|socket hang|network|temporarily|rate.?limit|\b429\b|\b5\d\d\b/i;

/** Run a CLI, registering its child for Stop, and retry once on a transient error. */
async function runCliTracked(cli, model, effort, cwd, prompt, chatId, cliId) {
  const onChunk = (chunk) => io.emit('chat_stream', { chatId, cliId, chunk });
  const onChild = (proc) => activeRuns.set(chatId, { kind: 'proc', proc, cliId });
  let result = await runCli(cli, model, effort, cwd, prompt, onChunk, onChild);
  if (result.status === 'error' && !stoppedIds.has(chatId) && TRANSIENT_RE.test(result.output || '')) {
    onChunk('\n[jarvis] transient error — retrying once…\n');
    await new Promise((r) => setTimeout(r, 1200));
    if (!stoppedIds.has(chatId)) result = await runCli(cli, model, effort, cwd, prompt, onChunk, onChild);
  }
  return result;
}

function emitSkillState(update) {
  io.emit('skill_state', update);
}

/**
 * Execute a skill end-to-end: emit RUNNING, spawn claude, stream stdout, record
 * real token usage, emit COMPLETED/FAILED. Shared by the router and button paths.
 */
async function executeSkill(skill, parameters) {
  // A skill disabled in the Skills dashboard must not run.
  if (!isSkillEnabled(skill.id)) {
    emitSkillState({
      skillId: skill.id,
      status: 'FAILED',
      progressPercentage: 100,
      currentActionLog: `${skill.label} is disabled — enable it in the Skills tab.`,
    });
    io.emit('terminal_log', `[jarvis] skill "${skill.id}" is disabled; refusing to run.\n`);
    return;
  }
  running += 1;
  io.emit('state_update', getState(running));

  emitSkillState({
    skillId: skill.id,
    status: 'RUNNING',
    progressPercentage: 5,
    currentActionLog: `Starting ${skill.label}...`,
  });

  const skillRunId = `skill:${skill.id}:${Date.now()}`;
  const result = await runSkill(
    skill.sop,
    parameters ?? {},
    (line) => io.emit('terminal_log', line),
    (proc) => activeSkillProcs.set(skillRunId, proc),
  );
  activeSkillProcs.delete(skillRunId);

  // Real token accounting: prompt chars in + output chars out.
  recordTokens((result.promptChars ?? 0) + result.output.length);

  running = Math.max(0, running - 1);
  emitSkillState({
    skillId: skill.id,
    status: result.status === 'success' ? 'COMPLETED' : 'FAILED',
    progressPercentage: 100,
    currentActionLog: result.status === 'success' ? 'Done.' : 'Failed — see terminal.',
    outputPayload: result.output,
  });
  io.emit('state_update', getState(running));
  io.emit('usage_update', getUsage(running));

  const reqRegex = /```jarvis:request-resource\s+({[\s\S]*?})\s+```/g;
  let match;
  while ((match = reqRegex.exec(result.output)) !== null) {
    try {
      io.emit('resource_requested', JSON.parse(match[1]));
    } catch (e) {}
  }
}

io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  socket.emit('state_update', getState(running)); // seed immediately
  socket.emit('cli_list', getRegistry());
  socket.emit('folders_list', { root: ROOT, vault: VAULT_PATH, folders: listFolders() });
  socket.emit('provider_list', listProviders());
  socket.emit('provider_types', API_TYPES);
  socket.emit('mcp_list', listMcp());
  socket.emit('skills_list', listSkills());
  socket.emit('usage_update', getUsage(running));
  socket.emit('agent_activity', [...taskBoard.values()]);
  socket.emit('approval_list', listApprovals());
  socket.emit('mission_list', listMissions());
  socket.emit('routing_profiles', ROUTING_PROFILES);
  socket.emit('capability_audit', capabilityAudit());
  getHealth(getRegistry(), listProviders(), listMcp()).then((health) => socket.emit('operations_health', health));

  // ── Skills dashboard — CRUD over the real SOP files on disk. A disabled skill
  // is refused at execution time, so the toggle genuinely stops it running. ──
  // Re-scan a project and refresh its sub-brain brief on demand. New projects are
  // analyzed automatically the first time they're seen (generateAllSubBrains), so
  // this is the manual "the project changed shape, re-read it" button.
  socket.on('analyze_folder', ({ folder } = {}) => {
    try {
      const res = analyzeFolder(folder || '');
      socket.emit('folder_analyzed', { folder: folder || '', ...res });
    } catch (e) {
      socket.emit('analyze_error', { folder: folder || '', message: e.message });
    }
  });

  socket.on('skills_request', ({ folder } = {}) => socket.emit('skills_list', listSkills(folder)));
  socket.on('skill_read', ({ id }) => socket.emit('skill_content', { id, content: readSkill(id) }));
  socket.on('skill_toggle', ({ id, enabled, folder }) => {
    setSkillEnabled(id, enabled, folder);
    io.emit('skills_list', listSkills(folder));
  });
  socket.on('skill_save', ({ id, content, folder }) => {
    saveSkill(id, content, folder);
    io.emit('skills_list', listSkills(folder));
  });
  socket.on('skill_delete', ({ id, folder }) => {
    deleteSkill(id, folder);
    io.emit('skills_list', listSkills(folder));
  });

  socket.on('enhance_prompt', async ({ reqId, cliId, folder, prompt }) => {
    const result = await enhancePrompt({ raw: prompt, cliId, folder, brainContext: getContext(folder) });
    socket.emit('prompt_enhanced', { reqId, result });
  });

  socket.on('get_roles', ({ folder } = {}) => {
    try {
      socket.emit('roles_state', {
        roles: getRoles(folder),
        registry: getRegistry(),
        providers: listProviders()
      });
    } catch (e) {
      console.error('[roles] get_roles error', e);
    }
  });

  socket.on('set_role', ({ role, config, folder }) => {
    try {
      setRole(role, config, folder);
      io.emit('roles_updated', {
        roles: getRoles(folder),
        registry: getRegistry(),
        providers: listProviders(),
        folder
      });
    } catch (e) {
      socket.emit('roles_error', { error: e.message });
    }
  });

  socket.on('clear_roles_override', ({ folder }) => {
    import('node:fs').then(fs => {
      import('node:path').then(path => {
        try {
          if (!folder) return;
          const file = path.join(process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects', '.jarvis-brain', 'folders', folder, 'roles.json');
          if (fs.existsSync(file)) fs.unlinkSync(file);
          io.emit('roles_updated', {
            roles: getRoles(folder),
            registry: getRegistry(),
            providers: listProviders(),
            folder
          });
        } catch(e) {
          console.error('[roles] clear_roles_override error', e);
        }
      }).catch(e => console.error(e));
    }).catch(e => console.error(e));
  });

  // ── Curated "best of" catalog — one-click seed the top MCPs + skills. ──
  socket.on('catalog_get', () => socket.emit('catalog_list', getCatalog()));
  socket.on('seed_best', ({ folder, extras } = {}) => {
    const base = seedBest(folder);
    const ex = extras === false ? { mcps: 0, skills: 0 } : seedExtras(folder);
    const counts = { mcps: base.mcps + ex.mcps, skills: base.skills + ex.skills };
    io.emit('mcp_list', listMcp(folder));
    io.emit('skills_list', listSkills(folder));
    socket.emit('seed_best_done', counts);
    io.emit('terminal_log', `[jarvis] seeded ${counts.mcps} MCPs + ${counts.skills} skills → ${folder || 'all projects'}\n`);
  });

  // ── Ruflow — token-lean mode + per-project memory bank. ──
  socket.on('ruflow_get', ({ folder } = {}) => socket.emit('ruflow_state', getRuflowState(folder)));
  socket.on('ruflow_set', ({ enabled, folder } = {}) => {
    const state = setRuflowEnabled(enabled, folder);
    io.emit('ruflow_state', state);
    io.emit('terminal_log', `[jarvis] ruflow ${enabled ? 'ON' : 'off'} for ${folder || 'all projects'}\n`);
  });
  socket.on('ruflow_memory_save', ({ folder, section, content } = {}) => {
    try {
      socket.emit('ruflow_state', writeMemoryBank(folder, section, content));
    } catch (e) {
      socket.emit('ruflow_error', { error: e.message });
    }
  });

  // ── One-click CLI terminal commands (editable per CLI). ──
  socket.on('cli_commands_request', () => socket.emit('cli_commands', getCliCommands()));
  socket.on('cli_command_set', ({ cliId, command }) => {
    try {
      const commands = setCliCommand(cliId, command);
      io.emit('cli_commands', commands);
      io.emit('cli_list', getRegistry()); // registry carries setupCmd too
    } catch (e) {
      socket.emit('cli_command_error', { error: e.message });
    }
  });
  // Open a real console window running the CLI's command (or an explicit override).
  socket.on('open_terminal', ({ cliId, command, folder } = {}) => {
    try {
      const cmd = (command && command.trim()) || getCliCommand(cliId);
      if (!cmd) throw new Error(`no command for ${cliId}`);
      const approval = requestApproval('terminal', { cliId, command: cmd }, folder || '');
      io.emit('approval_list', listApprovals());
      socket.emit('approval_requested', approval);
    } catch (e) {
      socket.emit('cli_command_error', { error: e.message });
    }
  });

  socket.on('plugins_request', ({ folder } = {}) => socket.emit('plugins_list', listPlugins(folder)));
  socket.on('plugin_add', ({ spec, folder }) => {
    addPlugin(spec, folder);
    io.emit('plugins_list', listPlugins(folder));
  });
  socket.on('plugin_remove', ({ id, folder }) => {
    removePlugin(id, folder);
    io.emit('plugins_list', listPlugins(folder));
  });
  socket.on('plugin_toggle', ({ id, enabled, folder }) => {
    setPluginEnabled(id, enabled, folder);
    io.emit('plugins_list', listPlugins(folder));
  });

  // ── Claude Code plugin parity — make CC plugins usable by every CLI + API. ──
  socket.on('claude_plugins_request', ({ folder } = {}) => {
    socket.emit('claude_plugins_list', { folder: folder || '', plugins: listClaudePlugins(folder) });
  });
  socket.on('claude_plugin_activate', ({ id, folder } = {}) => {
    try {
      const r = activateClaudePlugin(id, folder);
      io.emit('claude_plugins_list', { folder: folder || '', plugins: listClaudePlugins(folder) });
      io.emit('mcp_list', listMcp(folder));
      io.emit('skills_list', listSkills(folder));
      io.emit('terminal_log', `[jarvis] plugin '${id}' activated → +${r.added.mcps.length} MCP, +${r.added.skills.length} skills (all CLIs + APIs)\n`);
    } catch (e) {
      socket.emit('claude_plugin_error', { error: e.message });
    }
  });
  socket.on('claude_plugin_deactivate', ({ id, folder } = {}) => {
    const r = deactivateClaudePlugin(id, folder);
    io.emit('claude_plugins_list', { folder: folder || '', plugins: listClaudePlugins(folder) });
    io.emit('mcp_list', listMcp(folder));
    io.emit('skills_list', listSkills(folder));
    io.emit('terminal_log', `[jarvis] plugin '${id}' deactivated → -${r.removed.mcps} MCP, -${r.removed.skills} skills\n`);
  });
  socket.on('claude_plugin_toggle', ({ id, enabled, folder } = {}) => {
    toggleClaudePlugin(id, enabled, folder);
    io.emit('claude_plugins_list', { folder: folder || '', plugins: listClaudePlugins(folder) });
  });
  // Scaffold one of YOUR plugins — same format, same activate path, every CLI + API.
  socket.on('claude_plugin_scaffold', ({ name, folder } = {}) => {
    try {
      const { id, dir } = scaffoldLocalPlugin(name);
      io.emit('claude_plugins_list', { folder: folder || '', plugins: listClaudePlugins(folder) });
      socket.emit('plugin_scaffolded', { id, dir });
      io.emit('terminal_log', `[jarvis] scaffolded plugin '${id}' → ${dir}\n`);
    } catch (e) {
      socket.emit('claude_plugin_error', { error: e.message });
    }
  });
  socket.on('local_plugins_dir', () => socket.emit('local_plugins_dir_result', { dir: localPluginsDir() }));

  // ── Usage analytics — aggregated from the brain chat log + live telemetry. ──
  socket.on('usage_request', () => socket.emit('usage_update', getUsage(running)));
  socket.on('operations_health_request', async () => socket.emit('operations_health', await getHealth(getRegistry(), listProviders(), listMcp())));
  socket.on('operations_review_request', ({ folder } = {}) => { try { socket.emit('operations_review', getReviewEvidence(ROOT, folder)); } catch (e) { socket.emit('operations_review', { available: false, error: e.message }); } });
  socket.on('mission_list_request', ({ folder } = {}) => socket.emit('mission_list', listMissions(folder)));
  function launchAutomaticMissionStage(mission) {
    const stages = ['Research', 'Plan', 'Implement', 'Review', 'Test'];
    const stageName = stages[mission.stage];
    const profile = ROUTING_PROFILES[stageName];
    const available = [...getRegistry().filter((item) => item.available).map((item) => item.id), ...listProviders().map((item) => `api:${item.id}`)];
    const cliId = profile && (available.includes(profile.preferred) ? profile.preferred : available.includes(profile.fallback) ? profile.fallback : '');
    if (!cliId) {
      updateMission(mission.id, { status: 'blocked', note: `Automatic handoff paused: no available agent for ${stageName}.` });
      io.emit('mission_list', listMissions(mission.folder || ''));
      return;
    }
    updateMission(mission.id, { status: 'running', assigned: cliId, note: `${stageName} automatically assigned to ${cliId}` });
    io.emit('mission_list', listMissions(mission.folder || ''));
    const current = getMission(mission.id);
    const handoff = current?.history.slice(-3).map((item) => item.text).join('\n') || '';
    queueMicrotask(() => dispatchChat({
      cliId, model: '', effort: stageName === 'Implement' ? 'high' : 'medium', folder: mission.folder,
      missionId: mission.id, missionStage: stageName, confirmedCoding: true,
      prompt: `[Mission: ${mission.title}] You own the ${stageName} stage. ${handoff ? `Continue from this verified handoff:\n${handoff}\n\n` : ''}Read the shared brain, do this stage, record decisions and hand off a concise result to the next stage.`,
    }));
  }
  socket.on('mission_create', ({ title, folder, mode } = {}) => { try { const item = createMission({ title, folder, mode }); io.emit('mission_list', listMissions(folder)); socket.emit('mission_created', item); if (item.mode === 'automatic') launchAutomaticMissionStage(item); } catch (e) { socket.emit('mission_error', { error: e.message }); } });
  socket.on('mission_update', ({ id, patch, folder } = {}) => { try { updateMission(id, patch); io.emit('mission_list', listMissions(folder)); } catch (e) { socket.emit('mission_error', { error: e.message }); } });
  socket.on('capability_audit_request', ({ folder } = {}) => socket.emit('capability_audit', capabilityAudit(folder)));

  // ── Control: stop a single run, or the emergency kill-switch for everything. ──
  socket.on('chat_stop', ({ chatId }) => {
    if (stopRun(chatId)) io.emit('terminal_log', `[jarvis] stopped run ${chatId}\n`);
  });
  socket.on('stop_all', () => {
    const n = stopAll();
    io.emit('terminal_log', `[jarvis] KILL SWITCH — halted ${n} running task(s)\n`);
    io.emit('stopped_all', { count: n });
  });

  // ── Remember: pin a note into a project's (or the main) brain. ──
  socket.on('remember', ({ folder, text }) => {
    try {
      const r = appendNote(folder || '', text);
      socket.emit('remembered', { ...r });
      io.emit('terminal_log', `[jarvis] remembered → ${folder || 'main brain'}\n`);
    } catch (e) {
      socket.emit('remembered', { ok: false, error: e.message });
    }
  });

  // ── Search across every chat + durable brain note. ──
  socket.on('search', ({ query }) => {
    socket.emit('search_result', { query, results: searchBrain(query) });
  });

  // ── MCP servers — import once, generate every CLI's native config, and bridge
  // tools into API providers at runtime. Shared by all agents. ──
  socket.on('mcp_add', ({ name, command, args, env, url, transport, folder }) => {
    try {
      const approval = requestApproval('mcp', { name, command, args, env, url, transport }, folder || '');
      io.emit('approval_list', listApprovals());
      socket.emit('approval_requested', approval);
    } catch (e) {
      socket.emit('mcp_error', { error: e.message });
    }
  });
  socket.on('mcp_remove', ({ id, folder }) => {
    removeMcp(id, folder);
    io.emit('mcp_list', listMcp(folder));
  });
  socket.on('mcp_toggle', ({ id, enabled, folder }) => {
    setMcpEnabled(id, enabled, folder);
    io.emit('mcp_list', listMcp(folder));
  });
  socket.on('mcp_sync', () => socket.emit('mcp_synced', syncAll()));
  socket.on('approval_request_list', () => socket.emit('approval_list', listApprovals()));
  socket.on('approval_decide', ({ id, approved } = {}) => {
    try {
      const item = decideApproval(id, !!approved);
      if (item.status === 'approved') {
        if (item.type === 'mcp') { addMcp(item.payload, item.folder); io.emit('mcp_list', listMcp(item.folder)); }
        if (item.type === 'terminal') { openTerminal(item.payload.command, projectPath(ROOT, item.folder), item.payload.cliId || 'Jarvis'); }
      }
      io.emit('approval_list', listApprovals());
    } catch (e) { socket.emit('approval_error', { error: e.message }); }
  });

  // ── Custom API providers (OpenRouter / NVIDIA NIM / GitHub Models / any
  // OpenAI-compatible base URL). Add → discover models; the UI can filter free. ──
  socket.on('provider_add', async (spec) => {
    try {
      // Adapter engine detects the type + models, but never rejects a provider —
      // one without model discovery is saved in manual mode with a notice.
      const result = await addProvider(spec || {});
      io.emit('provider_list', listProviders());
      socket.emit('provider_added', result);
    } catch (e) {
      socket.emit('provider_error', { error: e.message });
    }
  });

  socket.on('provider_update', ({ id, patch }) => {
    try {
      updateProvider(id, patch || {});
      io.emit('provider_list', listProviders());
    } catch (e) {
      socket.emit('provider_error', { error: e.message });
    }
  });

  socket.on('provider_models', async ({ providerId }) => {
    try {
      socket.emit('provider_models_result', { providerId, models: await modelsForProvider(providerId) });
    } catch (e) {
      socket.emit('provider_error', { providerId, error: e.message });
    }
  });

  socket.on('provider_remove', ({ providerId }) => {
    removeProvider(providerId);
    io.emit('provider_list', listProviders());
  });

  // ── Chat: dispatch to either a real CLI (spawn in the project folder) or a
  // custom API provider (OpenAI-compatible HTTP), both with the shared brain. ──
  async function dispatchChat({ cliId, model, effort, folder, prompt, confirmedCoding, missionId, missionStage }) {
    const roles = getRoles(folder);
    const coderConfig = roles.coder;
    const CODER_CLI = (coderConfig.kind === 'api' || coderConfig.kind === 'provider') 
      ? `api:${coderConfig.id}` 
      : coderConfig.id;

    if (!confirmedCoding && cliId !== CODER_CLI) {
      const decision = await route('chat:' + randomUUID(), prompt, folder);
      if (decision && decision.isCodingTask) {
        socket.emit('confirm_coder_switch', {
          originalRequest: { cliId, model, effort, folder, prompt },
          coderCli: CODER_CLI,
          coderModel: coderConfig.model,
          coderEffort: coderConfig.effort
        });
        return;
      }
    }

    // Ruflow auto-routing: for simple, non-coding tasks, drop to low effort to save
    // tokens. Complex/coding prompts keep the requested effort. Off unless ruflow is on.
    if (isRuflowEnabled(folder) && effort && effort !== 'low') {
      const heavy = prompt.length > 240 ||
        /\b(refactor|implement|debug|build|architecture|migrate|fix|test|optimi[sz]e|design|analyze|review)\b/i.test(prompt);
      if (!heavy) {
        io.emit('terminal_log', `[jarvis] ruflow: '${effort}' → 'low' (simple task)\n`);
        effort = 'low';
      }
    }

    const chatId = randomUUID();
    const startedAt = Date.now();
    const augmented = `${getContext(folder)}\n\nUser request:\n${prompt}`;
    io.emit('chat_started', { chatId, cliId, model, effort, folder, prompt, ts: startedAt });
    taskBoard.set(chatId, { chatId, cli: cliId, folder: folder || '', prompt: String(prompt || '').replace(/\s+/g, ' ').slice(0, 220), startedAt });
    broadcastTaskBoard();

    // Provider ids are namespaced "api:<providerId>".
    const isApi = typeof cliId === 'string' && cliId.startsWith('api:');
    running += 1; // in-flight chats count toward the live AGENTS vital
    io.emit('state_update', getState(running));
    let result;
    if (isApi) {
      const providerId = cliId.slice(4);
      const controller = new AbortController();
      activeRuns.set(chatId, { kind: 'api', controller, cliId });
      // A raw API has no native effort flag, so mirror what cliRunner does for
      // non-native CLIs and inject it as a hint — otherwise the UI's effort
      // control would be decorative for API providers.
      const apiPrompt = effort ? `Reasoning effort: ${effort}.\n\n${augmented}` : augmented;
      result = await runApiChat(
        providerId, model, apiPrompt + coordinationContext(chatId),
        (chunk) => io.emit('chat_stream', { chatId, cliId, chunk }),
        controller.signal,
      );
    } else {
      const cli = getCli(cliId);
      if (!cli || !cli.available) {
        running = Math.max(0, running - 1);
        const entry = {
          chatId, cli: cliId, model, effort, folder: folder || '', prompt,
          response: `[jarvis] CLI "${cliId}" is not available on this machine.`,
          status: 'error', ts: Date.now(), durationMs: Date.now() - startedAt,
        };
        appendChat(entry);
        io.emit('chat_done', entry);
        io.emit('state_update', getState(running));
        return;
      }
      const cwd = projectPath(ROOT, folder);
      result = await runCliTracked(cli, model, effort, cwd, augmented + coordinationContext(chatId), chatId, cliId);
    }

    activeRuns.delete(chatId);
    taskBoard.delete(chatId);
    broadcastTaskBoard();
    running = Math.max(0, running - 1);
    let status = result.status;
    if (stoppedIds.has(chatId)) { status = 'stopped'; stoppedIds.delete(chatId); }
    const entry = {
      chatId, cli: cliId, model, effort, folder: folder || '', prompt,
      response: result.output, status, ts: Date.now(),
      durationMs: Date.now() - startedAt,
    };
    if (missionId) {
      try {
        const evidence = getReviewEvidence(ROOT, folder || '');
        const completion = completeMissionStage(missionId, missionStage, status, `${result.output || ''}\n${evidence.diff || ''}`);
        io.emit('mission_list', listMissions(folder || ''));
        if (completion.advanced) {
          const nextMission = getMission(missionId);
          if (nextMission) launchAutomaticMissionStage(nextMission);
        }
      } catch (e) { console.error('[mission] completion update failed:', e.message); }
    }
    // Real token accounting so the Usage tab reflects this exchange.
    recordTokens((augmented.length || 0) + (result.output?.length || 0));
    appendChat(entry);
    io.emit('chat_done', entry);
    io.emit('state_update', getState(running));
    io.emit('usage_update', getUsage(running));

    const reqRegex = /```jarvis:request-resource\s+({[\s\S]*?})\s+```/g;
    let match;
    while ((match = reqRegex.exec(result.output)) !== null) {
      try {
        io.emit('resource_requested', JSON.parse(match[1]));
      } catch (e) {}
    }
  }
  socket.on('chat_send', dispatchChat);

  socket.on('chats_history', ({ folder } = {}) => {
    socket.emit('chats_history_result', { folder: folder || '', chats: listChats(folder) });
  });

  // The frontend forwards STT output here.
  socket.on('transcript', async ({ transcriptId, text }) => {
    const decision = await route(transcriptId, text);
    io.emit('routing_decision', decision);

    const { targetSkillId } = decision;
    if (!targetSkillId) return; // UNMATCHED / CONVERSATION — nothing to execute

    if (UI_INTENTS.has(targetSkillId)) {
      io.emit('ui_intent', { intent: targetSkillId });
      return;
    }

    const skill = SKILLS[targetSkillId];
    if (skill) await executeSkill(skill, decision.extractedParameters);
  });

  // Direct skill trigger from a Skill Matrix button click (bypasses the router).
  socket.on('run_skill', async ({ skillId, parameters }) => {
    const skill = SKILLS[skillId];
    if (!skill) {
      io.emit('terminal_log', `[jarvis] unknown skill: ${skillId}\n`);
      return;
    }
    await executeSkill(skill, parameters);
  });

  let ptyProcess = null;

  socket.on('terminal_start', ({ cli, folder, cols, rows } = {}) => {
    if (ptyProcess) return;

    // WARNING: This gives full shell access! Bind to localhost only! No external exposure!
    const isWin = os.platform() === 'win32';
    const shell = isWin ? 'powershell.exe' : 'bash';

    // Launch the SAME command the pop-out console uses for this CLI (registry
    // default or the user's override), so every CLI — not just claude — opens
    // its interactive session here. Empty `cli` => a plain interactive shell.
    const launch = cli ? getCliCommand(cli) : '';
    let args;
    if (launch) {
      args = isWin ? ['-NoExit', '-Command', launch] : ['-lc', `${launch}; exec bash`];
    } else {
      args = isWin ? ['-NoLogo'] : ['-l'];
    }

    // Run in the selected project folder so the CLI acts on the right project.
    let cwd = ROOT;
    if (folder) {
      try { cwd = projectPath(ROOT, folder); } catch { socket.emit('terminal_data', '\r\n[jarvis] Invalid project folder.\r\n'); return; }
    }

    try {
      ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd,
        env: process.env
      });
      ptyProcess.onData((data) => {
        socket.emit('terminal_data', data);
      });
      ptyProcess.onExit(() => {
        socket.emit('terminal_exit');
        ptyProcess = null;
      });
    } catch (e) {
      socket.emit('terminal_data', `\r\nFailed to start terminal: ${e.message}\r\n`);
    }
  });

  socket.on('terminal_input', (data) => {
    if (ptyProcess) ptyProcess.write(data);
  });

  socket.on('terminal_resize', ({ cols, rows }) => {
    if (ptyProcess && cols && rows) {
      try { ptyProcess.resize(cols, rows); } catch (e) {}
    }
  });

  socket.on('disconnect', () => {
    console.log(`[ws] client left: ${socket.id}`);
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch (e) {}
      ptyProcess = null;
    }
  });
});

// Live-state heartbeat: sample the token series and push a fresh snapshot.
setInterval(() => {
  sampleTokens();
  io.emit('state_update', getState(running));
  io.emit('usage_update', getUsage(running));
}, 3000);

server.listen(PORT, HOST, () => console.log(`[jarvis] orchestrator on http://${HOST}:${PORT}`));
