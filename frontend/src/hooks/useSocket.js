import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useJarvisStore } from '../store';
import { extractSpokenSummary, speak } from '../lib/tts';

const ORCHESTRATOR_URL = 'http://localhost:3030';

let socket; // module singleton

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

    // Multi-CLI chat + brain
    socket.on('cli_list', (clis) => setClis(clis));
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
export function sendChat({ cliId, model, effort, folder, prompt }) {
  socket?.emit('chat_send', { cliId, model, effort, folder, prompt });
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

export function toggleMcp(id, enabled) {
  socket?.emit('mcp_toggle', { id, enabled });
}

// ── Skills dashboard ──
export function requestSkills() {
  socket?.emit('skills_request');
}
export function toggleSkill(id, enabled) {
  socket?.emit('skill_toggle', { id, enabled });
}
export function readSkill(id) {
  socket?.emit('skill_read', { id });
}
export function saveSkill(id, content) {
  socket?.emit('skill_save', { id, content });
}
export function deleteSkill(id) {
  socket?.emit('skill_delete', { id });
}

// ── Usage analytics ──
export function requestUsage() {
  socket?.emit('usage_request');
}

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
