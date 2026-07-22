import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useJarvisStore } from '../store';
import { extractSpokenSummary, speak } from '../lib/tts';

const ORCHESTRATOR_URL = 'http://localhost:3030';

let socket; // module singleton
const pendingEnhancements = new Map();

/**
 * Connects to the orchestrator and pipes WS events into the Zustand store.
 * Mount once near the app root.
 */
export function useSocket() {
  const upsertSkill = useJarvisStore((s) => s.upsertSkill);
  const pushLog = useJarvisStore((s) => s.pushLog);
  const clearPopups = useJarvisStore((s) => s.clearPopups);
  const setConnected = useJarvisStore((s) => s.setConnected);
  const setLiveState = useJarvisStore((s) => s.setLiveState);
  const setClis = useJarvisStore((s) => s.setClis);
  const setFolders = useJarvisStore((s) => s.setFolders);
  const startChatSession = useJarvisStore((s) => s.startChatSession);
  const appendChatChunk = useJarvisStore((s) => s.appendChatChunk);
  const finishChatSession = useJarvisStore((s) => s.finishChatSession);
  const setChatHistory = useJarvisStore((s) => s.setChatHistory);
  const setProviders = useJarvisStore((s) => s.setProviders);
  const setProviderModels = useJarvisStore((s) => s.setProviderModels);
  const setProviderError = useJarvisStore((s) => s.setProviderError);
  const setProviderTypes = useJarvisStore((s) => s.setProviderTypes);
  const setProviderNotice = useJarvisStore((s) => s.setProviderNotice);
  const setMcpServers = useJarvisStore((s) => s.setMcpServers);
  const setMcpError = useJarvisStore((s) => s.setMcpError);
  const setSkills = useJarvisStore((s) => s.setSkills);
  const setSkillContent = useJarvisStore((s) => s.setSkillContent);
  const setUsage = useJarvisStore((s) => s.setUsage);
  const setSearchResults = useJarvisStore((s) => s.setSearchResults);

  useEffect(() => {
    socket = io(ORCHESTRATOR_URL, { transports: ['websocket'] });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('terminal_log', (line) => pushLog(line));
    socket.on('skill_state', (update) => {
      upsertSkill(update);
      // On completion, speak the skill's summary line via the local TTS engine.
      if (update.status === 'COMPLETED' && update.outputPayload) {
        speak(extractSpokenSummary(update.outputPayload));
      }
    });
    socket.on('routing_decision', (d) =>
      pushLog(`[router] ${d.matchedTier} -> ${d.targetSkillId ?? 'UNMATCHED'}`),
    );
    socket.on('ui_intent', ({ intent }) => {
      if (intent === 'UI_CLEAR_CONTEXT') clearPopups();
    });
    socket.on('state_update', (state) => setLiveState(state));
    socket.on('agent_activity', (activity) => useJarvisStore.getState().setAgentActivity(activity || []));
    socket.on('operations_health', (health) => useJarvisStore.getState().setOperationsHealth(health));
    socket.on('operations_review', (review) => useJarvisStore.getState().setReviewEvidence(review));
    socket.on('approval_list', (approvals) => useJarvisStore.getState().setApprovals(approvals || []));
    socket.on('mission_list', (missions) => useJarvisStore.getState().setMissions(missions || []));
    socket.on('routing_profiles', (profiles) => useJarvisStore.getState().setRoutingProfiles(profiles || {}));

    // Multi-CLI chat + brain
    socket.on('cli_list', (clis) => setClis(clis));
    socket.on('cli_commands', (commands) => useJarvisStore.getState().setCliCommands(commands || {}));
    socket.on('folders_list', (payload) => setFolders(payload));
    socket.on('chat_started', (meta) => startChatSession(meta));
    socket.on('chat_stream', ({ chatId, chunk }) => appendChatChunk(chatId, chunk));
    socket.on('chat_done', (entry) => {
      finishChatSession(entry);
      // Desktop notification when a long-running task finishes in the background.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && (entry.durationMs || 0) > 15000) {
        const agent = entry.cli?.startsWith('api:') ? entry.cli.slice(4) : entry.cli;
        const verb = entry.status === 'stopped' ? 'stopped' : entry.status === 'success' ? 'finished' : 'failed';
        try {
          new Notification(`Jarvis · ${agent} ${verb}`, {
            body: `${entry.folder || 'main brain'} — ${(entry.prompt || '').slice(0, 90)}`,
          });
        } catch {
          /* ignore */
        }
      }
    });
    socket.on('chats_history_result', ({ chats }) => setChatHistory(chats));
    socket.on('search_result', ({ results }) => setSearchResults(results || []));

    // Custom API providers
    socket.on('provider_list', (list) => setProviders(list));
    socket.on('provider_types', (types) => setProviderTypes(types));
    socket.on('provider_added', ({ provider, models, discovered, message }) => {
      setProviderModels(provider.id, models || []);
      setProviderError('');
      setProviderNotice({ providerId: provider.id, label: provider.label, discovered: !!discovered, message: message || '' });
    });
    socket.on('provider_models_result', ({ providerId, models }) => setProviderModels(providerId, models));
    socket.on('provider_error', ({ error }) => setProviderError(error || 'provider error'));

    // MCP servers
    socket.on('mcp_list', (list) => setMcpServers(list));
    socket.on('mcp_added', () => setMcpError(''));
    socket.on('mcp_error', ({ error }) => setMcpError(error || 'mcp error'));

    // Skills dashboard + usage analytics
    socket.on('skills_list', (list) => setSkills(list));
    socket.on('skill_content', (payload) => setSkillContent(payload));
    socket.on('usage_update', (u) => setUsage(u));

    // Prompt enhancement
    socket.on('prompt_enhanced', ({ reqId, result }) => {
      if (pendingEnhancements.has(reqId)) {
        pendingEnhancements.get(reqId)(result);
        pendingEnhancements.delete(reqId);
      }
    });

    // Roles
    const setRoles = useJarvisStore.getState().setRoles;
    socket.on('roles_state', ({ roles }) => setRoles(roles));
    socket.on('roles_updated', ({ roles }) => setRoles(roles));

    // Ruflow (token-lean mode + memory bank)
    socket.on('ruflow_state', (state) => useJarvisStore.getState().setRuflow(state));

    // Plugins — custom Jarvis plugins + Claude Code plugin parity
    socket.on('plugins_list', (list) => useJarvisStore.getState().setPlugins(list || []));
    socket.on('claude_plugins_list', ({ plugins }) => useJarvisStore.getState().setClaudePlugins(plugins || []));

    // ── Surface backend error/success events that previously had NO listener at
    // all, so failures (role save, plugin activate, terminal open) were invisible. ──
    const toast = (kind, title) => (payload) =>
      useJarvisStore.getState().pushToast(kind, title, payload?.error || payload?.message || '');
    socket.on('roles_error', toast('error', 'Role not saved'));
    socket.on('ruflow_error', toast('error', 'Ruflow'));
    socket.on('cli_command_error', toast('error', 'CLI command'));
    socket.on('claude_plugin_error', toast('error', 'Plugin'));
    socket.on('terminal_opened', ({ command }) =>
      useJarvisStore.getState().pushToast('success', 'Terminal opened', command || ''));
    socket.on('plugin_scaffolded', ({ id, dir }) =>
      useJarvisStore.getState().pushToast('success', `Plugin '${id}' created`, `Edit it at ${dir}, then Activate`));
    socket.on('seed_best_done', ({ mcps, skills }) =>
      useJarvisStore.getState().pushToast('success', 'Seeded', `${mcps} MCP servers + ${skills} skills`));
    socket.on('stopped_all', ({ count }) =>
      useJarvisStore.getState().pushToast('success', 'Kill switch', `Halted ${count} running task(s)`));
    socket.on('mcp_synced', () =>
      useJarvisStore.getState().pushToast('success', 'MCP synced', 'All CLI configs updated'));
    socket.on('remembered', (r) => r?.ok === false
      ? useJarvisStore.getState().pushToast('error', 'Remember failed', r.error || '')
      : useJarvisStore.getState().pushToast('success', 'Saved to brain', ''));
    socket.on('folder_analyzed', ({ folder }) =>
      useJarvisStore.getState().pushToast('success', 'Project analyzed', `${folder || 'root'} — brief written to its brain`));
    socket.on('analyze_error', ({ folder, message }) =>
      useJarvisStore.getState().pushToast('error', 'Analyze failed', `${folder}: ${message}`));

    // Coder switch confirmation
    socket.on('confirm_coder_switch', ({ originalRequest, coderCli }) => {
      // We will handle this by showing a popup in the UI. For now, dispatch event or handle via state.
      // Since useSocket is a hook, we can dispatch to window so the component can listen.
      window.dispatchEvent(new CustomEvent('jarvis:coder_switch', { detail: { originalRequest, coderCli } }));
    });

    // Resource request
    socket.on('resource_requested', (resource) => {
      window.dispatchEvent(new CustomEvent('jarvis:resource_requested', { detail: resource }));
    });

    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [
    upsertSkill,
    pushLog,
    clearPopups,
    setConnected,
    setLiveState,
    setClis,
    setFolders,
    startChatSession,
    appendChatChunk,
    finishChatSession,
    setChatHistory,
    setProviders,
    setProviderModels,
    setProviderError,
    setProviderTypes,
    setProviderNotice,
    setMcpServers,
    setMcpError,
    setSkills,
    setSkillContent,
    setUsage,
    setSearchResults,
  ]);
}

/** Send an STT transcript to the router (Tier 1/2/3 resolution). */
export function sendTranscript(transcriptId, text) {
  socket?.emit('transcript', { transcriptId, text });
}

/** Directly trigger a skill by its backend id (bypasses the router). */
export function sendSkill(skillId, parameters = {}) {
  socket?.emit('run_skill', { skillId, parameters });
}

/** Send a chat to a real CLI (runs it on the machine with the shared brain). */
export function sendChat({ cliId, model, effort, folder, prompt, missionId, missionStage }) {
  socket?.emit('chat_send', { cliId, model, effort, folder, prompt, missionId, missionStage });
}

/** Request the brain's chat history for a folder ('' = global). */
export function requestChats(folder = '') {
  socket?.emit('chats_history', { folder });
}

/**
 * Add any API provider. Routed through the adapter engine (auto-detect by default).
 * @param {{name?, baseUrl, apiKey?, providerType?, headers?, model?, endpoints?, apiVersion?}} spec
 */
export function addProvider(spec) {
  socket?.emit('provider_add', spec);
}

/** Patch a saved provider (e.g. set a manual model, add headers). */
export function updateProvider(id, patch) {
  socket?.emit('provider_update', { id, patch });
}

/** Re-fetch a provider's model catalog. */
export function requestProviderModels(providerId) {
  socket?.emit('provider_models', { providerId });
}

/** Remove a custom provider. */
export function removeProvider(providerId) {
  socket?.emit('provider_remove', { providerId });
}

/** Import an MCP server (command+args for stdio, or url for http). Syncs all CLIs. */
export function addMcp({ name, command, args, env, url, transport }) {
  socket?.emit('mcp_add', { name, command, args, env, url, transport });
}

export function removeMcp(id) {
  socket?.emit('mcp_remove', { id });
}

export function toggleMcp(id, enabled, folder) {
  socket?.emit('mcp_toggle', { id, enabled, folder });
}

/**
 * Re-push the registry into every CLI's native config. add/remove/toggle already
 * sync, so this is the manual repair path for when a CLI's config drifts — e.g. you
 * hand-edited it, or another tool clobbered the managed block.
 */
export function syncMcps() {
  socket?.emit('mcp_sync');
}

/**
 * Re-scan a project and refresh its sub-brain brief. Projects self-analyze on first
 * use, so this is only for forcing a refresh after the project changes shape.
 */
export function analyzeFolder(folder = '') {
  socket?.emit('analyze_folder', { folder });
}

// ── Skills dashboard ──
export function requestSkills(folder) {
  socket?.emit('skills_request', { folder });
}
export function toggleSkill(id, enabled, folder) {
  socket?.emit('skill_toggle', { id, enabled, folder });
}
export function readSkill(id) {
  socket?.emit('skill_read', { id });
}
export function saveSkill(id, content) {
  socket?.emit('skill_save', { id, content });
}
export function deleteSkill(id, folder) {
  socket?.emit('skill_delete', { id, folder });
}

// ── Plugins ──
export function requestPlugins(folder) {
  socket?.emit('plugins_request', { folder });
}
export function addPlugin(spec, folder) {
  socket?.emit('plugin_add', { spec, folder });
}
export function removePlugin(id, folder) {
  socket?.emit('plugin_remove', { id, folder });
}
export function togglePlugin(id, enabled, folder) {
  socket?.emit('plugin_toggle', { id, enabled, folder });
}

// ── Claude Code plugin parity (usable by every CLI + API) ──
export function requestClaudePlugins(folder = '') {
  socket?.emit('claude_plugins_request', { folder });
}
export function activateClaudePlugin(id, folder = '') {
  socket?.emit('claude_plugin_activate', { id, folder });
}
export function deactivateClaudePlugin(id, folder = '') {
  socket?.emit('claude_plugin_deactivate', { id, folder });
}
export function toggleClaudePlugin(id, enabled, folder = '') {
  socket?.emit('claude_plugin_toggle', { id, enabled, folder });
}
/** Scaffold one of your own plugins (same format → reaches every CLI + API). */
export function scaffoldPlugin(name, folder = '') {
  socket?.emit('claude_plugin_scaffold', { name, folder });
}

// ── Usage analytics ──
export function requestUsage() {
  socket?.emit('usage_request');
}
export function requestOperationsHealth() { socket?.emit('operations_health_request'); }
export function requestReviewEvidence(folder = '') { socket?.emit('operations_review_request', { folder }); }
export function requestApprovals() { socket?.emit('approval_request_list'); }
export function decideApproval(id, approved) { socket?.emit('approval_decide', { id, approved }); }
export function requestMissions(folder = '') { socket?.emit('mission_list_request', { folder }); }
export function createMission(title, folder = '', mode = 'manual', pipeline) { socket?.emit('mission_create', { title, folder, mode, pipeline }); }
export function updateMission(id, patch, folder = '') { socket?.emit('mission_update', { id, patch, folder }); }

// ── Control + memory + search ──
export function stopChat(chatId) {
  socket?.emit('chat_stop', { chatId });
}
export function stopAll() {
  socket?.emit('stop_all');
}
export function remember(folder, text) {
  socket?.emit('remember', { folder, text });
}
export function searchBrain(query) {
  socket?.emit('search', { query });
}

export function enhancePromptRequest(cliId, folder, prompt) {
  return new Promise((resolve) => {
    const reqId = Date.now().toString() + Math.random().toString();
    pendingEnhancements.set(reqId, resolve);
    socket?.emit('enhance_prompt', { reqId, cliId, folder, prompt });
  });
}

// ── Curated best-of catalog ──
export function requestCatalog() {
  socket?.emit('catalog_get');
}
export function seedBest(folder = '') {
  socket?.emit('seed_best', { folder });
}

// ── Ruflow — token-lean mode + per-project memory bank ──
export function requestRuflow(folder = '') {
  socket?.emit('ruflow_get', { folder });
}
export function setRuflow(enabled, folder = '') {
  socket?.emit('ruflow_set', { enabled, folder });
}
export function saveRuflowMemory(folder, section, content) {
  socket?.emit('ruflow_memory_save', { folder, section, content });
}

// ── One-click CLI terminal commands ──
/** Fetch the merged { cliId: command } map. */
export function requestCliCommands() {
  socket?.emit('cli_commands_request');
}
/** Save (or reset, if command is empty) a CLI's terminal command. */
export function setCliCommand(cliId, command) {
  socket?.emit('cli_command_set', { cliId, command });
}
/** Open a real console window running the CLI's command (or an explicit override). */
export function openTerminal(cliId, folder = '', command) {
  socket?.emit('open_terminal', { cliId, folder, command });
}

// ── Roles ──
export function requestRoles(folder) {
  socket?.emit('get_roles', { folder });
}
export function setRoleConfig(role, config, folder) {
  socket?.emit('set_role', { role, config, folder });
}
export function clearRolesOverride(folder) {
  socket?.emit('clear_roles_override', { folder });
}
