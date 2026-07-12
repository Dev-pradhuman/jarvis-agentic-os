import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plug, Plus, Power, Trash2, X, Zap } from "lucide-react";
import { useJarvisStore } from "../store";
import { addMcp, addProvider, removeMcp, removeProvider, toggleMcp, updateProvider } from "../hooks/useSocket";

export const CLI_COLOR: Record<string, string> = {
  claude: "#8b5cf6",
  opencode: "#10b981",
  gemini: "#3b82f6",
  codex: "#f59e0b",
  antigravity: "#ec4899",
};
export const API_COLOR = "#22d3ee"; // cyan for custom API providers

export function agentColor(id: string) {
  if (id.startsWith("api:")) return API_COLOR;
  return CLI_COLOR[id] ?? "#8b5cf6";
}

export function fmtWhen(ts?: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function agentLabel(id: string) {
  return id.startsWith("api:") ? id.slice(4) : id;
}

/** Modal: import MCP servers (shared by all CLIs + API providers). */
export function McpModal({ onClose }: { onClose: () => void }) {
  const mcpServers = useJarvisStore((s) => s.mcpServers);
  const mcpError = useJarvisStore((s) => s.mcpError);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");

  const PRESETS = [
    { name: "filesystem", command: "npx", args: "-y @modelcontextprotocol/server-filesystem C:/" },
    { name: "memory", command: "npx", args: "-y @modelcontextprotocol/server-memory" },
    { name: "sequential-thinking", command: "npx", args: "-y @modelcontextprotocol/server-sequential-thinking" },
    { name: "fetch", command: "npx", args: "-y @kazuph/mcp-fetch" },
  ];

  function submit() {
    if (mode === "stdio" ? !command.trim() : !url.trim()) return;
    addMcp({
      name: name.trim() || (mode === "http" ? "http-mcp" : command.trim()),
      transport: mode,
      command: mode === "stdio" ? command.trim() : "",
      args: mode === "stdio" ? args.trim() : "",
      url: mode === "http" ? url.trim() : "",
    });
    setName(""); setCommand(""); setArgs(""); setUrl("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div className="glass-panel w-[560px] max-w-[92vw] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4" style={{ color: "#f472b6" }} />
            <span className="font-mono text-[12px] tracking-[0.2em] uppercase text-white/90">MCP Servers</span>
          </div>
          <button onClick={onClose} className="grid place-items-center h-7 w-7 rounded-md hover:bg-white/[0.05]">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="font-mono text-[10px] text-muted-foreground mb-3">
          Imported once, then written into every CLI's native config (Claude, Codex, Gemini, OpenCode) and bridged
          into API providers as callable tools. Existing servers you already had are preserved.
        </div>

        <div className="flex gap-1.5 mb-3">
          <button
            onClick={() => setMode("stdio")}
            className="font-mono text-[10px] px-2.5 py-1 rounded-md border"
            style={{ color: mode === "stdio" ? "#f472b6" : "#c9c9cc", borderColor: mode === "stdio" ? "#f472b666" : "rgba(255,255,255,0.08)" }}
          >
            stdio (command)
          </button>
          <button
            onClick={() => setMode("http")}
            className="font-mono text-[10px] px-2.5 py-1 rounded-md border"
            style={{ color: mode === "http" ? "#f472b6" : "#c9c9cc", borderColor: mode === "http" ? "#f472b666" : "rgba(255,255,255,0.08)" }}
          >
            http / sse (url)
          </button>
        </div>

        {mode === "stdio" && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => { setName(p.name); setCommand(p.command); setArgs(p.args); }}
                className="font-mono text-[10px] px-2 py-1 rounded-md border border-white/[0.08] text-white/70 hover:border-white/20"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem"
          className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
        {mode === "stdio" ? (
          <>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Command</label>
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx"
              className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
            <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Args</label>
            <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem C:/"
              className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
          </>
        ) : (
          <>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse"
              className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
          </>
        )}

        {mcpError && <div className="mb-3 font-mono text-[11px]" style={{ color: "#f87171" }}>{mcpError}</div>}

        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] text-muted-foreground">Syncs all CLI configs on import.</div>
          <button onClick={submit}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-mono text-[11px] uppercase tracking-wider"
            style={{ background: "#f472b622", border: "1px solid #f472b666", color: "#f472b6" }}>
            <Plus className="h-3.5 w-3.5" /> Import
          </button>
        </div>

        {mcpServers.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Imported ({mcpServers.length}) — shared by all agents
            </div>
            <div className="flex flex-col gap-1">
              {mcpServers.map((m: any) => (
                <div key={m.id} className="flex items-center gap-2 font-mono text-[11px] text-white/75">
                  <Plug className="h-3 w-3" style={{ color: m.enabled ? "#f472b6" : "#666" }} />
                  <span>{m.label || m.name}</span>
                  <span className="text-muted-foreground truncate">
                    {m.transport === "http" ? m.url : `${m.command} ${(m.args || []).join(" ")}`}
                  </span>
                  <button onClick={() => toggleMcp(m.id, !m.enabled)} className="ml-auto grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title={m.enabled ? "Disable" : "Enable"}>
                    <Power className="h-3 w-3" style={{ color: m.enabled ? "#10b981" : "#666" }} />
                  </button>
                  <button onClick={() => removeMcp(m.id)} className="grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Remove (also purges from CLI configs)">
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PROVIDER_PRESETS = [
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", providerType: "openrouter" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", providerType: "groq" },
  { label: "Anthropic", baseUrl: "https://api.anthropic.com", providerType: "anthropic" },
  { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", providerType: "gemini" },
  { label: "Ollama", baseUrl: "http://localhost:11434", providerType: "ollama" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1", providerType: "openai" },
  { label: "vLLM", baseUrl: "http://localhost:8000/v1", providerType: "openai" },
  { label: "Azure OpenAI", baseUrl: "https://<resource>.openai.azure.com", providerType: "azure" },
  { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", providerType: "openai" },
  { label: "GitHub Models", baseUrl: "https://models.github.ai/inference", providerType: "openai" },
];
const ENDPOINT_KINDS = ["chat", "models", "embeddings", "image", "audio"] as const;
const inputCls =
  "w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20";

/** Modal: add ANY API provider (auto-detect by default) via the adapter engine. */
export function AddProviderModal({ onClose }: { onClose: () => void }) {
  const providers = useJarvisStore((s) => s.providers);
  const providerTypes = useJarvisStore((s) => s.providerTypes);
  const providerError = useJarvisStore((s) => s.providerError);
  const setProviderError = useJarvisStore((s) => s.setProviderError);
  const providerNotice = useJarvisStore((s) => s.providerNotice);
  const setProviderNotice = useJarvisStore((s) => s.setProviderNotice);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerType, setProviderType] = useState("unknown");
  const [model, setModel] = useState("");
  const [headers, setHeaders] = useState<{ k: string; v: string }[]>([{ k: "", v: "" }]);
  const [endpoints, setEndpoints] = useState<Record<string, string>>({});
  const [apiVersion, setApiVersion] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualModel, setManualModel] = useState("");

  // Clear any stale notice when the modal opens; drop it again on unmount.
  useEffect(() => { setProviderNotice(null); return () => setProviderNotice(null); }, [setProviderNotice]);
  // React to the add outcome: discovered → close; manual mode → show the notice.
  useEffect(() => {
    if (submitting && providerNotice) {
      setSubmitting(false);
      if (providerNotice.discovered) onClose();
    }
  }, [providerNotice, submitting, onClose]);
  useEffect(() => { if (providerError) setSubmitting(false); }, [providerError]);

  function applyPreset(p: (typeof PROVIDER_PRESETS)[number]) {
    setName(p.label); setBaseUrl(p.baseUrl); setProviderType(p.providerType);
  }

  function submit() {
    if (!baseUrl.trim()) return;
    setProviderError("");
    setProviderNotice(null);
    setSubmitting(true);
    const hdr: Record<string, string> = {};
    for (const { k, v } of headers) if (k.trim()) hdr[k.trim()] = v;
    addProvider({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      providerType,
      model: model.trim() || undefined,
      headers: hdr,
      endpoints,
      apiVersion: apiVersion.trim() || undefined,
    });
  }

  function saveManualModel() {
    if (!providerNotice) return;
    if (manualModel.trim()) updateProvider(providerNotice.providerId, { model: manualModel.trim() });
    onClose();
  }

  const manualMode = providerNotice && !providerNotice.discovered;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="glass-panel w-[560px] max-w-[94vw] p-5 flex flex-col" style={{ maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" style={{ color: API_COLOR }} />
            <span className="font-mono text-[12px] tracking-[0.2em] uppercase text-white/90">Add API Provider</span>
          </div>
          <button onClick={onClose} className="grid place-items-center h-7 w-7 rounded-md hover:bg-white/[0.05]">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="overflow-y-auto pr-1" style={{ scrollbarWidth: "none" }}>
          {manualMode ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border p-3 font-mono text-[11px] leading-[1.6]" style={{ borderColor: "#f59e0b55", background: "#f59e0b12", color: "#fcd34d" }}>
                {providerNotice?.message || "Automatic model discovery is unavailable. You can still use this provider by specifying a model."}
              </div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Model name</label>
              <input value={manualModel} onChange={(e) => setManualModel(e.target.value)} autoFocus
                placeholder="e.g. gpt-4o-mini, claude-3-5-sonnet, llama3.1" className={inputCls} />
              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="font-mono text-[11px] px-3 py-2 rounded-lg border border-white/[0.08] text-white/70">Skip</button>
                <button onClick={saveManualModel} className="font-mono text-[11px] px-3.5 py-2 rounded-lg uppercase tracking-wider"
                  style={{ background: `${API_COLOR}22`, border: `1px solid ${API_COLOR}66`, color: API_COLOR }}>Save model</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {PROVIDER_PRESETS.map((p) => (
                  <button key={p.label} onClick={() => applyPreset(p)}
                    className="font-mono text-[10px] px-2 py-1 rounded-md border border-white/[0.08] text-white/70 hover:border-white/20">{p.label}</button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Provider" className={inputCls} />
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">API Type</label>
                  <select value={providerType} onChange={(e) => setProviderType(e.target.value)} className={inputCls}>
                    {(providerTypes.length ? providerTypes : [{ id: "unknown", label: "Auto Detect" }]).map((t: any) => (
                      <option key={t.id} value={t.id} className="bg-[#0b0b0f]">{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Base URL</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className={`${inputCls} mb-3`} />

              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">API Key <span className="normal-case opacity-60">(optional)</span></label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="stored locally in the brain, never in git" className={`${inputCls} mb-3`} />

              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Model <span className="normal-case opacity-60">(optional — required if discovery fails)</span></label>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-4o-mini" className={`${inputCls} mb-3`} />

              <button onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2 hover:text-white/70">
                {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Advanced — custom headers & endpoint overrides
              </button>
              {advanced && (
                <div className="rounded-lg border border-white/[0.06] p-3 mb-3 flex flex-col gap-3">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5">Custom headers</div>
                    {headers.map((h, i) => (
                      <div key={i} className="flex items-center gap-1.5 mb-1.5">
                        <input value={h.k} onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="Header-Name"
                          className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1 font-mono text-[10px] text-white/90 outline-none" />
                        <input value={h.v} onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder="value"
                          className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1 font-mono text-[10px] text-white/90 outline-none" />
                      </div>
                    ))}
                    <button onClick={() => setHeaders((hs) => [...hs, { k: "", v: "" }])} className="font-mono text-[10px] px-2 py-0.5 rounded-md border border-white/[0.08] text-white/60">+ header</button>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5">Endpoint overrides (relative to base URL)</div>
                    {ENDPOINT_KINDS.map((k) => (
                      <div key={k} className="flex items-center gap-2 mb-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground w-[70px]">{k}</span>
                        <input value={endpoints[k] || ""} onChange={(e) => setEndpoints((o) => ({ ...o, [k]: e.target.value }))}
                          placeholder={k === "chat" ? "/v2/chat" : k === "models" ? "/v1/listModels" : ""}
                          className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1 font-mono text-[10px] text-white/90 outline-none" />
                      </div>
                    ))}
                    {providerType === "azure" && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-[10px] text-muted-foreground w-[70px]">api-version</span>
                        <input value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} placeholder="2024-06-01"
                          className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1 font-mono text-[10px] text-white/90 outline-none" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {providerError && <div className="mb-3 font-mono text-[11px]" style={{ color: "#f87171" }}>{providerError}</div>}

              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] text-muted-foreground">Auto-detects type & models; saves either way.</div>
                <button onClick={submit} disabled={!baseUrl.trim() || submitting}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-mono text-[11px] uppercase tracking-wider disabled:opacity-40"
                  style={{ background: `${API_COLOR}22`, border: `1px solid ${API_COLOR}66`, color: API_COLOR }}>
                  {submitting ? "Detecting…" : "Add Provider"}
                </button>
              </div>
            </>
          )}

          {providers.length > 0 && !manualMode && (
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Connected</div>
              <div className="flex flex-col gap-1">
                {providers.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-2 font-mono text-[11px] text-white/75">
                    <Zap className="h-3 w-3" style={{ color: API_COLOR }} />
                    <span>{p.label}</span>
                    <span className="px-1.5 rounded text-[9px]" style={{ background: "rgba(255,255,255,0.05)", color: "#9ca3af" }}>{p.providerType}</span>
                    {p.manual && <span className="text-[9px]" style={{ color: "#fcd34d" }}>manual{p.model ? ` · ${p.model}` : ""}</span>}
                    <span className="text-muted-foreground truncate">{p.baseUrl}</span>
                    <button onClick={() => removeProvider(p.id)} className="ml-auto grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Remove">
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shared sub-brain sidebar used by Chats + Projects. */
export function BrainSidebar() {
  const folders = useJarvisStore((s) => s.folders);
  const projectsRoot = useJarvisStore((s) => s.projectsRoot);
  const vaultPath = useJarvisStore((s) => s.vaultPath);
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const setActiveFolder = useJarvisStore((s) => s.setActiveFolder);
  return (
    <aside className="glass-panel flex flex-col gap-3 p-4 overflow-hidden h-full">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4" style={{ color: "#a78bfa" }} />
        <div className="font-mono text-[11px] tracking-[0.25em] text-white/90">THE BRAIN</div>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground truncate" title={projectsRoot}>{projectsRoot || "…"}</div>
      {vaultPath && (
        <div className="rounded-md border px-2 py-1.5" style={{ borderColor: "#7c3aed40", background: "#7c3aed12" }} title={vaultPath}>
          <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "#a78bfa" }}>📓 Obsidian vault · live</div>
          <div className="font-mono text-[9px] text-muted-foreground truncate">{vaultPath}</div>
        </div>
      )}
      <button onClick={() => setActiveFolder("")} className="text-left px-2.5 py-2 rounded-lg border transition-colors"
        style={{ borderColor: activeFolder === "" ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.08)", background: activeFolder === "" ? "rgba(139,92,246,0.08)" : "transparent" }}>
        <div className="font-sans text-[12px] text-white">Main brain</div>
        <div className="font-mono text-[10px] text-muted-foreground">all folders · all CLIs</div>
      </button>
      <div className="font-sans uppercase tracking-[0.18em] text-[10px] text-muted-foreground mt-1">Sub-brains</div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-1" style={{ scrollbarWidth: "none" }}>
        {folders.map((f: string) => (
          <button key={f} onClick={() => setActiveFolder(f)}
            className="text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 transition-colors hover:bg-white/[0.03]"
            style={{ background: activeFolder === f ? "rgba(139,92,246,0.10)" : "transparent" }}>
            <span className="font-mono text-[12px] text-white/85 truncate">{f}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
