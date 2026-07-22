import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Check, ChevronDown, Gauge, Mic, Plug, Plus, Send, Sparkles, Square, StopCircle, Terminal, TerminalSquare, X, Zap } from "lucide-react";
import { useJarvisStore } from "../store";
import { enhancePromptRequest, openTerminal, remember, requestChats, requestCliCommands, requestProviderModels, requestRoles, requestRuflow, seedBest, sendChat, setRuflow, stopChat } from "../hooks/useSocket";
import { createRecorder } from "../lib/sttRecorder";
import { AddProviderModal, agentColor, agentLabel, BrainSidebar, fmtWhen, McpModal } from "./shared";
import { RolesModal } from "./RolesModal";
import { CliCommandsModal } from "./CliCommandsModal";
import { CommandTerminal } from "./Terminal";

type ChatEntry = {
  chatId: string;
  cli: string;
  model?: string;
  effort?: string;
  folder?: string;
  prompt: string;
  response?: string;
  status?: string;
  ts?: number;
};

export function ChatsTab() {
  const clis = useJarvisStore((s) => s.clis);
  const providers = useJarvisStore((s) => s.providers);
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const panes = useJarvisStore((s) => s.panes);
  const togglePane = useJarvisStore((s) => s.togglePane);
  const addPane = useJarvisStore((s) => s.addPane);
  const mcpServers = useJarvisStore((s) => s.mcpServers);
  const ruflow = useJarvisStore((s) => s.ruflow);
  const [showAdd, setShowAdd] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [showCmds, setShowCmds] = useState(false);
  const [resourceReq, setResourceReq] = useState<any>(null);

  useEffect(() => {
    const handler = (e: any) => setResourceReq(e.detail);
    window.addEventListener('jarvis:resource_requested', handler);
    requestCliCommands(); // load per-CLI terminal commands
    return () => window.removeEventListener('jarvis:resource_requested', handler);
  }, []);

  const agents = useMemo(
    () => [
      ...clis.map((c: any) => ({ id: c.id, label: c.label, available: c.available, kind: "cli" as const })),
      ...providers.map((p: any) => ({ id: `api:${p.id}`, label: p.label, available: true, kind: "api" as const })),
    ],
    [clis, providers],
  );

  // Load persisted history for the active folder on mount / folder change.
  useEffect(() => {
    requestChats(activeFolder);
    requestRoles(activeFolder);
    requestRuflow(activeFolder);
  }, [activeFolder]);

  // Open a first pane automatically so the tab is never empty.
  useEffect(() => {
    if (panes.length === 0 && agents.length) {
      const first = agents.find((a) => a.available);
      if (first) addPane(first.id); // idempotent — safe under StrictMode double-invoke
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  // Responsive tiling: 1 → single, 2 → side-by-side, 3-4 → 2 cols, 5+ → 3 cols.
  const cols = panes.length <= 1 ? 1 : panes.length <= 4 ? 2 : 3;

  return (
    <div className="h-full w-full grid gap-3 p-3" style={{ gridTemplateColumns: "220px 1fr" }}>
      <BrainSidebar />

      <section className="flex flex-col min-h-0 h-full gap-3">
        {/* Agent dock — click to tile a CLI/API in or out */}
        <div className="glass-panel flex flex-wrap items-center gap-2 px-3 py-2.5">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/80 mr-1">Agents</span>
          {agents.map((a) => {
            const color = agentColor(a.id);
            const open = panes.includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => a.available && togglePane(a.id)}
                disabled={!a.available}
                title={a.available ? `${open ? "Close" : "Open"} ${a.label}` : `${a.label} — not installed`}
                className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-1"
                style={{
                  color: open ? color : "#c9c9cc",
                  borderColor: open ? `${color}66` : "rgba(255,255,255,0.08)",
                  background: open ? `${color}14` : "rgba(255,255,255,0.02)",
                }}
              >
                {a.kind === "api" && <Zap className="h-3 w-3" style={{ color }} />}
                {a.label}
                {open && <span className="opacity-70">●</span>}
                {!a.available && " ·off"}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setRuflow(!ruflow?.enabled, activeFolder)}
              className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-colors"
              style={ruflow?.enabled
                ? { color: "#f59e0b", borderColor: "#f59e0b88", background: "#f59e0b1a" }
                : { color: "#c9c9cc", borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
              title={`Ruflow — token-lean mode + memory bank (${ruflow?.enabled ? "ON" : "off"}) for ${activeFolder || "all projects"}`}>
              <Gauge className="h-3 w-3" /> Ruflow{ruflow?.enabled ? " ·on" : ""}
            </button>
            <button onClick={() => setShowRoles(true)}
              className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed flex items-center gap-1"
              style={{ color: "#a855f7", borderColor: "#a855f755" }} title="Configure Agent Roles">
              <Sparkles className="h-3 w-3" /> Roles
            </button>
            <button onClick={() => setShowCmds(true)}
              className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed flex items-center gap-1"
              style={{ color: "#34d399", borderColor: "#34d39955" }} title="Edit & run each CLI's terminal command (login / launch)">
              <TerminalSquare className="h-3 w-3" /> Cmd
            </button>
            <button onClick={() => setShowAdd(true)}
              className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed flex items-center gap-1"
              style={{ color: "#22d3ee", borderColor: "#22d3ee55" }} title="Add an OpenAI-compatible API provider">
              <Plus className="h-3 w-3" /> API
            </button>
            <button onClick={() => setShowMcp(true)}
              className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed flex items-center gap-1"
              style={{ color: "#f472b6", borderColor: "#f472b655" }} title="Import MCP servers — shared by every agent">
              <Plug className="h-3 w-3" /> MCP{mcpServers.length ? ` ·${mcpServers.length}` : ""}
            </button>
            <button onClick={() => seedBest(activeFolder)}
              className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed flex items-center gap-1"
              style={{ color: "#818cf8", borderColor: "#818cf855" }}
              title={`Seed the best MCPs + skills into ${activeFolder || "all projects"}`}>
              <Plus className="h-3 w-3" /> Best
            </button>
          </div>
        </div>

        {/* Tiled chat panes — every open agent is usable simultaneously */}
        {panes.length === 0 ? (
          <div className="glass-panel flex-1 grid place-items-center text-muted-foreground font-mono text-[12px]">
            Pick an agent above to open a chat tile. Open several to run them side by side.
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}>
            <AnimatePresence>
              {panes.map((id) => (
                <motion.div key={id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.18 }} className="min-h-0">
                  <ChatPane agentId={id} onClose={() => togglePane(id)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {showAdd && <AddProviderModal onClose={() => setShowAdd(false)} />}
      {showMcp && <McpModal onClose={() => setShowMcp(false)} />}
      {showRoles && <RolesModal onClose={() => setShowRoles(false)} />}
      {showCmds && <CliCommandsModal onClose={() => setShowCmds(false)} />}
      {resourceReq && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-white/10 p-4 rounded-lg shadow-xl max-w-sm w-full font-mono text-[11px] text-white/90">
            <h3 className="text-yellow-400 mb-2 font-bold flex items-center gap-2"><Zap className="h-4 w-4"/> Resource Requested</h3>
            <p className="mb-4 text-white/70">An agent requested a capability not currently active:</p>
            <pre className="bg-black/50 p-2 rounded border border-white/5 mb-4 overflow-x-auto text-[10px]">
              {JSON.stringify(resourceReq, null, 2)}
            </pre>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20" onClick={() => setResourceReq(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pin an exchange into the active brain's durable notes. */
function RememberBtn({ folder, text }: { folder: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { remember(folder, text); setDone(true); setTimeout(() => setDone(false), 1600); }}
      title={done ? "Saved to brain" : `Remember this in ${folder || "the main brain"}`}
      className="shrink-0 grid place-items-center h-5 w-5 rounded hover:bg-white/[0.06]"
    >
      {done ? <Check className="h-3 w-3" style={{ color: "#10b981" }} /> : <Bookmark className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

/**
 * Searchable model switcher. A plain <select> is unusable once a provider exposes
 * a large catalog (BluesMinds ships 132), so this filters as you type.
 */
function ModelPicker({
  models, value, onChange, color, placeholder,
}: { models: any[]; value: string; onChange: (id: string) => void; color: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return models;
    return models.filter((m: any) => `${m.label ?? ""} ${m.id}`.toLowerCase().includes(s));
  }, [models, q]);

  const current = models.find((m: any) => m.id === value);
  const shown = current?.label ?? value ?? "";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((o) => !o); setQ(""); }}
        title={value || placeholder}
        className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.08] hover:border-white/20 rounded-md px-1.5 py-1 font-mono text-[10px] text-white/85 max-w-[160px] transition-colors"
      >
        <span className="truncate">{shown || placeholder}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[290px] glass-panel p-1.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search models…"
            className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-white/20 rounded px-2 py-1 font-mono text-[11px] text-white/90 outline-none"
          />
          <div className="max-h-[240px] overflow-y-auto mt-1" style={{ scrollbarWidth: "none" }}>
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center font-mono text-[10px] text-muted-foreground">no match</div>
            )}
            {filtered.map((m: any) => {
              const active = m.id === value;
              return (
                <button
                  key={m.id}
                  onClick={() => { onChange(m.id); setOpen(false); setQ(""); }}
                  title={m.id}
                  className="w-full text-left px-2 py-1.5 rounded font-mono text-[11px] truncate hover:bg-white/[0.05] transition-colors"
                  style={active ? { color, background: `${color}1a` } : { color: "#c9c9cc" }}
                >
                  {m.label ?? m.id}
                </button>
              );
            })}
          </div>
          <div className="px-2 pt-1 font-mono text-[9px] text-muted-foreground">
            {filtered.length === models.length ? `${models.length} models` : `${filtered.length} of ${models.length}`}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Effort switcher. Real for every agent: CLIs with a native flag get it passed
 * through (claude --effort, codex model_reasoning_effort), everything else — the
 * other CLIs and API providers — has it injected as a prompt hint by the backend.
 */
function EffortPicker({
  value, onChange, options, color, native,
}: { value: string; onChange: (e: string) => void; options: string[]; color: string; native: boolean }) {
  return (
    <div
      className="flex items-center rounded-md overflow-hidden border border-white/[0.08] shrink-0"
      title={`Reasoning effort: ${value}${native ? " (native flag)" : " (prompt hint)"}`}
    >
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            title={o}
            className="px-1.5 py-1 font-mono text-[9px] uppercase transition-colors"
            style={active ? { background: `${color}22`, color } : { color: "#87878a" }}
          >
            {o[0]}
          </button>
        );
      })}
    </div>
  );
}

function ChatPane({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const clis = useJarvisStore((s) => s.clis);
  const providers = useJarvisStore((s) => s.providers);
  const providerModels = useJarvisStore((s) => s.providerModels);
  const freeOnly = useJarvisStore((s) => s.freeOnly);
  const chatSessions = useJarvisStore((s) => s.chatSessions);
  const chatHistory = useJarvisStore((s) => s.chatHistory);
  const activeFolder = useJarvisStore((s) => s.activeFolder);

  const isApi = agentId.startsWith("api:");
  const provider = isApi ? providers.find((p: any) => `api:${p.id}` === agentId) : null;
  const cli = !isApi ? clis.find((c: any) => c.id === agentId) : null;
  const color = agentColor(agentId);

  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("medium");
  const [prompt, setPrompt] = useState("");
  const [recording, setRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const recRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const addPane = useJarvisStore((s) => s.addPane);

  const [enhancing, setEnhancing] = useState(false);
  const [enhanceNote, setEnhanceNote] = useState("");
  const [pendingSwitch, setPendingSwitch] = useState<{ req: any; coder: string; coderModel?: string; coderEffort?: string } | null>(null);

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail.originalRequest.cliId === agentId && e.detail.originalRequest.folder === activeFolder) {
        setPendingSwitch({ 
          req: e.detail.originalRequest, 
          coder: e.detail.coderCli, 
          coderModel: e.detail.coderModel, 
          coderEffort: e.detail.coderEffort 
        });
      }
    };
    window.addEventListener('jarvis:coder_switch', handler);
    return () => window.removeEventListener('jarvis:coder_switch', handler);
  }, [agentId, activeFolder]);

  async function handleEnhance() {
    const text = prompt.trim();
    if (!text) return;
    setEnhancing(true);
    setEnhanceNote("");
    const res = await enhancePromptRequest(agentId, activeFolder, text) as any;
    if (res.changed) {
      setPrompt(res.enhanced);
      setEnhanceNote(res.note || "Prompt enhanced.");
    } else {
      setEnhanceNote(res.note || "Already clear.");
    }
    setEnhancing(false);
    setTimeout(() => setEnhanceNote(""), 3000);
  }

  const models = useMemo(() => {
    if (isApi && provider) {
      const list = providerModels[provider.id] ?? [];
      return (freeOnly ? list.filter((m: any) => m.free) : list).map((m: any) => ({ id: m.id, label: m.free ? `${m.label} ·free` : m.label }));
    }
    return cli?.models ?? [];
  }, [isApi, provider, providerModels, freeOnly, cli]);

  useEffect(() => {
    if (isApi && provider && !providerModels[provider.id]) requestProviderModels(provider.id);
  }, [isApi, provider, providerModels]);
  useEffect(() => {
    if (models.length && !models.some((m: any) => m.id === model)) setModel(models[0].id);
  }, [models, model]);

  // This pane's slice of the conversation: its agent, current folder.
  const messages: ChatEntry[] = useMemo(() => {
    const byId = new Map<string, ChatEntry>();
    for (const h of chatHistory as ChatEntry[]) if (h.cli === agentId) byId.set(h.chatId, h);
    for (const s of chatSessions as ChatEntry[]) {
      if (s.cli === agentId && (!s.folder || s.folder === activeFolder)) byId.set(s.chatId, { ...byId.get(s.chatId), ...s });
    }
    return [...byId.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  }, [chatHistory, chatSessions, agentId, activeFolder]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const streamingId = messages.find((m) => m.status === "streaming")?.chatId;
  const running = !!streamingId;
  const canSend = isApi ? !!provider : !!cli?.available;

  function submit() {
    const text = prompt.trim();
    if (!text || !canSend) return;
    sendChat({ cliId: agentId, model, effort, folder: activeFolder, prompt: text });
    setPrompt("");
  }

  async function toggleMic() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const rec = createRecorder({ onLevel: setMicLevel });
    recRef.current = rec;
    setRecording(true);
    try {
      await rec.start();
      const text = await rec.done;
      setRecording(false);
      setMicLevel(0);
      if (text) setPrompt((p) => (p ? `${p} ${text}` : text));
    } catch {
      setRecording(false);
      setMicLevel(0);
    }
  }

  return (
    <div className="glass-panel flex flex-col min-h-0 h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ color, background: `${color}1a`, border: `1px solid ${color}40` }}>
          {agentLabel(agentId)}
        </span>
        {isApi && running && (
          <button onClick={() => streamingId && stopChat(streamingId)} title="Stop this run"
            className="flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f87171", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)" }}>
            <StopCircle className="h-3 w-3" /> stop
          </button>
        )}
        {!isApi && (
          <button
            onClick={() => setShowTerminal((v) => !v)}
            title={showTerminal ? "Switch to piped chat" : "Open a live interactive terminal for this CLI"}
            className="ml-auto flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded"
            style={showTerminal
              ? { color, background: `${color}1a`, border: `1px solid ${color}55` }
              : { color: "#9ca3af", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <TerminalSquare className="h-3 w-3" /> {showTerminal ? "chat" : "term"}
          </button>
        )}
        <div className={`${isApi ? "ml-auto " : ""}flex items-center gap-1.5`}>
          <EffortPicker
            value={effort}
            onChange={setEffort}
            options={cli?.efforts ?? ["low", "medium", "high"]}
            color={color}
            native={!!cli?.nativeEffort}
          />
          <ModelPicker
            models={models}
            value={model}
            onChange={setModel}
            color={color}
            placeholder={isApi ? "discovering…" : "—"}
          />
        </div>
        <button onClick={onClose} className="grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Close tile">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {showTerminal && !isApi ? (
        <div className="flex-1 overflow-hidden relative">
          <CommandTerminal cli={agentId} folder={activeFolder} />
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2" style={{ scrollbarWidth: "none" }}>
            {messages.length === 0 && <div className="text-muted-foreground font-mono text-[11px] mt-4 text-center">No messages yet.</div>}
            {messages.map((m) => (
              <div key={m.chatId} className="rounded-lg border border-white/[0.06] overflow-hidden">
                <div className="px-2.5 py-1.5 bg-white/[0.02] font-sans text-[12px] text-white/90 flex items-start gap-2">
                  <span className="flex-1">{m.prompt}</span>
                  <RememberBtn folder={activeFolder} text={`${m.prompt} → ${(m.response || "").slice(0, 400)}`} />
                  <span className="font-mono text-[9px] text-muted-foreground shrink-0">{fmtWhen(m.ts)}</span>
                </div>
                {(m.response || m.status === "streaming") && (
                  <div className="px-2.5 py-1.5 border-t border-white/[0.05] bg-black/20">
                    <pre className="font-mono text-[11px] text-white/75 whitespace-pre-wrap break-words leading-[1.5] m-0">{m.response || "…"}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-white/[0.06] p-2 flex items-end gap-1.5 relative">
            {pendingSwitch && (
              <div className="absolute inset-x-2 bottom-full mb-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-200/90 text-[11px] shadow-xl flex flex-col gap-2 backdrop-blur-md z-10">
                <div>This looks like a code change — run it on <b className="text-yellow-400">{pendingSwitch.coder}</b> instead for consistent codebase style?</div>
                <div className="flex gap-2 font-mono">
                  <button className="bg-white/10 hover:bg-white/20 px-2 py-1 rounded" onClick={() => {
                    sendChat({ ...pendingSwitch.req, confirmedCoding: true });
                    setPendingSwitch(null);
                    setPrompt("");
                  }}>Run here anyway</button>
                  <button className="bg-yellow-500/20 hover:bg-yellow-500/30 px-2 py-1 rounded border border-yellow-500/50 text-yellow-400" onClick={() => {
                    addPane(pendingSwitch.coder);
                    sendChat({ 
                      ...pendingSwitch.req, 
                      cliId: pendingSwitch.coder, 
                      model: pendingSwitch.coderModel, 
                      effort: pendingSwitch.coderEffort, 
                      confirmedCoding: true 
                    });
                    setPendingSwitch(null);
                    setPrompt("");
                  }}>Switch & run</button>
                  <button className="ml-auto opacity-50 hover:opacity-100" onClick={() => {
                    setPrompt(pendingSwitch.req.prompt);
                    setPendingSwitch(null);
                  }}>Cancel</button>
                </div>
              </div>
            )}
            <button onClick={toggleMic} title={recording ? "Stop & transcribe" : "Voice to prompt"}
              className="grid place-items-center h-9 w-9 rounded-lg border transition-colors shrink-0"
              style={{ borderColor: recording ? "#ef444488" : "rgba(255,255,255,0.08)", background: recording ? `rgba(239,68,68,${0.15 + micLevel * 0.5})` : "rgba(255,255,255,0.02)" }}>
              {recording ? <Square className="h-3.5 w-3.5" style={{ color: "#ef4444" }} /> : <Mic className="h-4 w-4 text-muted-foreground" />}
            </button>
            <div className="flex-1 flex flex-col gap-1 relative">
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} rows={2}
                placeholder={canSend ? `Task in ${activeFolder || "main brain"}… (⌘/Ctrl+Enter)` : "Unavailable"}
                className="w-full resize-none bg-white/[0.03] border border-white/[0.08] rounded-lg px-2.5 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
              {enhanceNote && <div className="absolute right-2 top-2 text-[10px] text-green-400/80 bg-black/40 px-1 rounded pointer-events-none">{enhanceNote}</div>}
            </div>
            <button onClick={handleEnhance} disabled={!prompt.trim() || enhancing || !canSend} title="Enhance Prompt"
              className="grid place-items-center h-9 w-9 rounded-lg disabled:opacity-35 shrink-0 hover:bg-white/[0.05]"
              style={{ color: "#a855f7", border: "1px dashed rgba(168,85,247,0.4)" }}>
              <Sparkles className={`h-4 w-4 ${enhancing ? "animate-pulse" : ""}`} />
            </button>
            <button onClick={submit} disabled={!prompt.trim() || !canSend}
              className="grid place-items-center h-9 w-9 rounded-lg disabled:opacity-35 shrink-0"
              style={{ background: `${color}22`, border: `1px solid ${color}66`, color }}>
              <Send className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
