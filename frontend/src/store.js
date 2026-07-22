import { create } from 'zustand';

// Session restore: the last tab, folder, open chat tiles, and free-only filter are
// persisted so reopening Jarvis lands you exactly where you left off.
const SAVED = (() => {
  try {
    return JSON.parse(localStorage.getItem('jarvis:session') || '{}');
  } catch {
    return {};
  }
})();

/**
 * Global Jarvis state (Section 1). Three domains, no prop-drilling:
 *   - Audio    : drives the 3D core sphere + status lights
 *   - Skills   : progress cards + terminal feed
 *   - Popups   : glassmorphism context cards (z-index stacking)
 */
export const useJarvisStore = create((set) => ({
  // ---- Command palette + search ----
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  searchResults: [],
  setSearchResults: (searchResults) => set({ searchResults }),
  // ---- Connection ----
  connected: false, // orchestrator WebSocket reachable
  setConnected: (connected) => set({ connected }),

  // ---- Live system state (real data pushed by the orchestrator) ----
  liveState: null, // { vitals, documents, directives, calendar, tokens, tokensLabel }
  setLiveState: (liveState) => set({ liveState }),

  // ---- View / tabs ----
  view: SAVED.view || 'projects', // 'projects' | 'chats' | 'skills' | 'mcps' | 'usage'
  setView: (view) => set({ view }),

  // ---- Chats: split-screen panes (one agent per tile, all usable at once) ----
  panes: Array.isArray(SAVED.panes) ? SAVED.panes : [], // restored open chat tiles
  addPane: (id) =>
    set((s) => (s.panes.includes(id) ? s : { panes: [...s.panes, id], view: 'chats' })),
  removePane: (id) => set((s) => ({ panes: s.panes.filter((p) => p !== id) })),
  togglePane: (id) =>
    set((s) => (s.panes.includes(id) ? { panes: s.panes.filter((p) => p !== id) } : { panes: [...s.panes, id] })),

  // ---- Skills dashboard (real SOP files) ----
  skills: [], // [{id,label,enabled,registered,bytes,updated,preview}]
  setSkills: (skills) => set({ skills }),
  plugins: [], // custom Jarvis plugins [{id,label,enabled}]
  setPlugins: (plugins) => set({ plugins }),
  claudePlugins: [], // Claude Code plugins made portable [{id,label,description,counts,activated,enabled}]
  setClaudePlugins: (claudePlugins) => set({ claudePlugins }),
  skillContent: null, // { id, content } for the editor
  setSkillContent: (skillContent) => set({ skillContent }),

  // ---- Usage analytics ----
  usage: null, // { agents:[...], totals:{...}, live:{...} }
  setUsage: (usage) => set({ usage }),

  // ---- Operations workspace: live orchestration data ----
  agentActivity: [],
  setAgentActivity: (agentActivity) => set({ agentActivity }),
  missions: [],
  setMissions: (missions) => set({ missions }),
  addMission: (mission) => set((s) => ({ missions: [mission, ...s.missions].slice(0, 30) })),
  updateMission: (id, patch) => set((s) => ({ missions: s.missions.map((m) => m.id === id ? { ...m, ...patch } : m) })),
  operationsHealth: null,
  setOperationsHealth: (operationsHealth) => set({ operationsHealth }),
  reviewEvidence: null,
  setReviewEvidence: (reviewEvidence) => set({ reviewEvidence }),
  approvals: [],
  setApprovals: (approvals) => set({ approvals }),
  routingProfiles: {},
  setRoutingProfiles: (routingProfiles) => set({ routingProfiles }),

  // ---- Multi-CLI chat + brain ----
  clis: [], // [{id,label,available,models,efforts,nativeEffort,setupCmd}]
  setClis: (clis) => set({ clis }),
  cliCommands: {}, // { [cliId]: "terminal command" } — one-click editable per CLI
  setCliCommands: (cliCommands) => set({ cliCommands }),
  projectsRoot: '',
  vaultPath: '', // .jarvis-brain Obsidian vault path
  folders: [], // subfolders of the projects root (sub-brains)
  setFolders: ({ root, vault, folders }) => set({ projectsRoot: root, vaultPath: vault || '', folders }),
  activeFolder: SAVED.activeFolder || '', // '' = main brain
  setActiveFolder: (activeFolder) => set({ activeFolder }),
  projectStats: null,
  setProjectStats: (projectStats) => set({ projectStats }),
  terminalConnected: false,
  setTerminalConnected: (terminalConnected) => set({ terminalConnected }),

  roles: null, // { enhancer: {kind, id, model, effort}, coder: {kind, id, model, effort} }
  setRoles: (roles) => set({ roles }),

  ruflow: null, // { enabled, globalEnabled, folder, files:{activeContext,decisions,patterns,progress} }
  setRuflow: (ruflow) => set({ ruflow }),

  // ---- Toasts — surface backend error/success events that were being swallowed ----
  toasts: [], // [{id, kind:'error'|'success', title, message}]
  pushToast: (kind, title, message) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, kind, title, message }].slice(-4) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  chatSessions: [], // live sessions this UI session (streaming)
  startChatSession: (meta) =>
    set((s) => ({ chatSessions: [...s.chatSessions, { ...meta, response: '', status: 'streaming' }] })),
  appendChatChunk: (chatId, chunk) =>
    set((s) => ({
      chatSessions: s.chatSessions.map((c) =>
        c.chatId === chatId ? { ...c, response: c.response + chunk } : c,
      ),
    })),
  finishChatSession: (entry) =>
    set((s) => {
      const found = s.chatSessions.some((c) => c.chatId === entry.chatId);
      const chatSessions = found
        ? s.chatSessions.map((c) => (c.chatId === entry.chatId ? { ...c, ...entry } : c))
        : [...s.chatSessions, { ...entry }];
      return { chatSessions };
    }),

  chatHistory: [], // loaded from the brain for the active folder
  setChatHistory: (chatHistory) => set({ chatHistory }),

  // ---- Custom API providers (OpenRouter / NVIDIA NIM / GitHub Models / …) ----
  providers: [], // [{id,label,baseUrl,kind,type:'api',hasKey}]
  setProviders: (providers) => set({ providers }),
  providerModels: {}, // { [providerId]: [{id,label,free}] }
  setProviderModels: (providerId, models) =>
    set((s) => ({ providerModels: { ...s.providerModels, [providerId]: models } })),
  freeOnly: SAVED.freeOnly ?? false,
  setFreeOnly: (freeOnly) => set({ freeOnly }),
  providerError: '',
  setProviderError: (providerError) => set({ providerError }),
  providerTypes: [], // [{id,label}] — API types incl. Auto Detect
  setProviderTypes: (providerTypes) => set({ providerTypes }),
  providerNotice: null, // { providerId, label, discovered, message } after an add
  setProviderNotice: (providerNotice) => set({ providerNotice }),

  // ---- MCP servers (shared by all CLIs + API providers) ----
  mcpServers: [], // [{id,name,label,transport,command,args,url,enabled}]
  setMcpServers: (mcpServers) => set({ mcpServers }),
  mcpError: '',
  setMcpError: (mcpError) => set({ mcpError }),

  // ---- Audio ----
  isListening: false,
  decibelLevel: 0, // normalized 0..1
  isSpeaking: false,
  setListening: (isListening) => set({ isListening }),
  setDecibel: (decibelLevel) => set({ decibelLevel }),
  setSpeaking: (isSpeaking) => set({ isSpeaking }),

  // ---- Skill queue ----
  activeSkills: [], // SkillStateUpdate[]
  historicalLogs: [], // string[] (terminal feed lines)
  upsertSkill: (update) =>
    set((s) => {
      const i = s.activeSkills.findIndex((sk) => sk.skillId === update.skillId);
      const next = [...s.activeSkills];
      if (i === -1) next.push(update);
      else next[i] = { ...next[i], ...update };
      return { activeSkills: next };
    }),
  removeSkill: (skillId) =>
    set((s) => ({ activeSkills: s.activeSkills.filter((sk) => sk.skillId !== skillId) })),
  pushLog: (line) =>
    set((s) => ({ historicalLogs: [...s.historicalLogs.slice(-499), line] })),

  // ---- Context popups ----
  activePopups: [], // ContextPopup[]
  addPopup: (popup) => set((s) => ({ activePopups: [...s.activePopups, popup] })),
  removePopup: (id) =>
    set((s) => ({ activePopups: s.activePopups.filter((p) => p.id !== id) })),
  clearPopups: () => set({ activePopups: [] }),
}));

// Persist the session (tab, folder, open tiles, filter) so a reload restores it.
useJarvisStore.subscribe((s) => {
  try {
    localStorage.setItem(
      'jarvis:session',
      JSON.stringify({ view: s.view, activeFolder: s.activeFolder, panes: s.panes, freeOnly: s.freeOnly }),
    );
  } catch {
    /* storage unavailable */
  }
});

// Convenience selector used by the audio-reactive sphere.
export const useAudioStore = useJarvisStore;
