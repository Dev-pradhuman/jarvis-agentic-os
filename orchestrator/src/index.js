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

import 'dotenv/config';
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';

import { route } from './router.js';
import { runSkill } from './skillRunner.js';
import { SKILLS, UI_INTENTS } from './skills.js';
import { getState, recordTokens, sampleTokens } from './state.js';
import { getCli, getRegistry } from './cli.js';
import { killProcessTree, runCli } from './cliRunner.js';
import { addProvider, API_TYPES, listProviders, modelsForProvider, removeProvider, runApiChat, updateProvider } from './providers.js';
import { addMcp, listMcp, mcpCatalog, removeMcp, setEnabled, syncAll } from './mcp.js';
import { appendChat, appendNote, ensureBrain, generateAllSubBrains, getContext, listChats, listFolders, ROOT, searchBrain, VAULT_PATH } from './brain.js';
import { deleteSkill, isSkillEnabled, listSkills, readSkill, saveSkill, setSkillEnabled } from './skillsManager.js';
import { getUsage } from './usage.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 3030);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'orchestrator' }));
app.get('/skills', (_req, res) => res.json(Object.values(SKILLS)));
app.get('/state', (_req, res) => res.json(getState(running)));
app.get('/clis', (_req, res) => res.json(getRegistry()));
app.get('/folders', (_req, res) => res.json({ root: ROOT, vault: VAULT_PATH, folders: listFolders() }));
app.get('/providers', (_req, res) => res.json(listProviders()));
app.get('/provider-types', (_req, res) => res.json(API_TYPES));
app.get('/skills-manage', (_req, res) => res.json(listSkills()));
app.get('/usage', (_req, res) => res.json(getUsage(running)));
app.get('/search', (req, res) => res.json({ query: req.query.q || '', results: searchBrain(req.query.q || '') }));
app.get('/mcp', (_req, res) => res.json(listMcp()));
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
const io = new Server(server, { cors: { origin: '*' } });

let running = 0; // skills + chats currently executing (drives the AGENTS vital)

// ── Active-run registry — lets Stop / kill-switch halt in-flight work ──
const activeRuns = new Map(); // chatId -> { kind:'proc'|'api', proc?, controller?, cliId }
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

  // ── Skills dashboard — CRUD over the real SOP files on disk. A disabled skill
  // is refused at execution time, so the toggle genuinely stops it running. ──
  socket.on('skills_request', () => socket.emit('skills_list', listSkills()));
  socket.on('skill_read', ({ id }) => socket.emit('skill_content', { id, content: readSkill(id) }));
  socket.on('skill_toggle', ({ id, enabled }) => {
    setSkillEnabled(id, enabled);
    io.emit('skills_list', listSkills());
  });
  socket.on('skill_save', ({ id, content }) => {
    saveSkill(id, content);
    io.emit('skills_list', listSkills());
  });
  socket.on('skill_delete', ({ id }) => {
    deleteSkill(id);
    io.emit('skills_list', listSkills());
  });

  // ── Usage analytics — aggregated from the brain chat log + live telemetry. ──
  socket.on('usage_request', () => socket.emit('usage_update', getUsage(running)));

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
  socket.on('mcp_add', ({ name, command, args, env, url, transport }) => {
    try {
      const result = addMcp({ name, command, args, env, url, transport });
      io.emit('mcp_list', listMcp());
      socket.emit('mcp_added', result);
    } catch (e) {
      socket.emit('mcp_error', { error: e.message });
    }
  });
  socket.on('mcp_remove', ({ id }) => {
    removeMcp(id);
    io.emit('mcp_list', listMcp());
  });
  socket.on('mcp_toggle', ({ id, enabled }) => {
    setEnabled(id, enabled);
    io.emit('mcp_list', listMcp());
  });
  socket.on('mcp_sync', () => socket.emit('mcp_synced', syncAll()));

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
  socket.on('chat_send', async ({ cliId, model, effort, folder, prompt }) => {
    const chatId = randomUUID();
    const startedAt = Date.now();
    const augmented = `${getContext(folder)}\n\nUser request:\n${prompt}`;
    io.emit('chat_started', { chatId, cliId, model, effort, folder, prompt, ts: startedAt });

    // Provider ids are namespaced "api:<providerId>".
    const isApi = typeof cliId === 'string' && cliId.startsWith('api:');
    running += 1; // in-flight chats count toward the live AGENTS vital
    io.emit('state_update', getState(running));
    let result;
    if (isApi) {
      const providerId = cliId.slice(4);
      const controller = new AbortController();
      activeRuns.set(chatId, { kind: 'api', controller, cliId });
      result = await runApiChat(
        providerId, model, augmented,
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
      const cwd = folder ? path.join(ROOT, folder) : ROOT;
      result = await runCliTracked(cli, model, effort, cwd, augmented, chatId, cliId);
    }

    activeRuns.delete(chatId);
    running = Math.max(0, running - 1);
    let status = result.status;
    if (stoppedIds.has(chatId)) { status = 'stopped'; stoppedIds.delete(chatId); }
    const entry = {
      chatId, cli: cliId, model, effort, folder: folder || '', prompt,
      response: result.output, status, ts: Date.now(),
      durationMs: Date.now() - startedAt,
    };
    // Real token accounting so the Usage tab reflects this exchange.
    recordTokens((augmented.length || 0) + (result.output?.length || 0));
    appendChat(entry);
    io.emit('chat_done', entry);
    io.emit('state_update', getState(running));
    io.emit('usage_update', getUsage(running));
  });

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

  socket.on('disconnect', () => console.log(`[ws] client left: ${socket.id}`));
});

// Live-state heartbeat: sample the token series and push a fresh snapshot.
setInterval(() => {
  sampleTokens();
  io.emit('state_update', getState(running));
  io.emit('usage_update', getUsage(running));
}, 3000);

server.listen(PORT, () => console.log(`[jarvis] orchestrator on http://localhost:${PORT}`));
