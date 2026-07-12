import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Check, Mic, Plug, Plus, Send, Square, StopCircle, Terminal, X, Zap } from "lucide-react";
import { useJarvisStore } from "../store";
import { remember, requestChats, requestProviderModels, sendChat, stopChat } from "../hooks/useSocket";
import { createRecorder } from "../lib/sttRecorder";
import { AddProviderModal, agentColor, agentLabel, BrainSidebar, fmtWhen, McpModal } from "./shared";

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
  const [showAdd, setShowAdd] = useState(false);
  const [showMcp, setShowMcp] = useState(false);

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
  const scrollRef = useRef<HTMLDivElement>(null);

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
        {running && (
          <button onClick={() => streamingId && stopChat(streamingId)} title="Stop this run"
            className="flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f87171", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)" }}>
            <StopCircle className="h-3 w-3" /> stop
          </button>
        )}
        <select value={model} onChange={(e) => setModel(e.target.value)}
          className="ml-auto bg-white/[0.03] border border-white/[0.08] rounded-md px-1.5 py-1 font-mono text-[10px] text-white/85 outline-none max-w-[150px]">
          {models.length === 0 && <option className="bg-[#0b0b0f]">{isApi ? "discovering…" : "—"}</option>}
          {models.map((m: any) => <option key={m.id} value={m.id} className="bg-[#0b0b0f]">{m.label}</option>)}
        </select>
        {!isApi && (
          <select value={effort} onChange={(e) => setEffort(e.target.value)}
            className="bg-white/[0.03] border border-white/[0.08] rounded-md px-1.5 py-1 font-mono text-[10px] text-white/85 outline-none">
            {(cli?.efforts ?? ["low", "medium", "high"]).map((e: string) => <option key={e} value={e} className="bg-[#0b0b0f]">{e}</option>)}
          </select>
        )}
        <button onClick={onClose} className="grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Close tile">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

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

      <div className="border-t border-white/[0.06] p-2 flex items-end gap-1.5">
        <button onClick={toggleMic} title={recording ? "Stop & transcribe" : "Voice to prompt"}
          className="grid place-items-center h-9 w-9 rounded-lg border transition-colors shrink-0"
          style={{ borderColor: recording ? "#ef444488" : "rgba(255,255,255,0.08)", background: recording ? `rgba(239,68,68,${0.15 + micLevel * 0.5})` : "rgba(255,255,255,0.02)" }}>
          {recording ? <Square className="h-3.5 w-3.5" style={{ color: "#ef4444" }} /> : <Mic className="h-4 w-4 text-muted-foreground" />}
        </button>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} rows={2}
          placeholder={canSend ? `Task in ${activeFolder || "main brain"}… (⌘/Ctrl+Enter)` : "Unavailable"}
          className="flex-1 resize-none bg-white/[0.03] border border-white/[0.08] rounded-lg px-2.5 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
        <button onClick={submit} disabled={!prompt.trim() || !canSend}
          className="grid place-items-center h-9 w-9 rounded-lg disabled:opacity-35 shrink-0"
          style={{ background: `${color}22`, border: `1px solid ${color}66`, color }}>
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
