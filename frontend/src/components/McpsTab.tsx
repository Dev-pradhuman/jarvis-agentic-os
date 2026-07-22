import { useEffect, useMemo, useState } from "react";
import { KeyRound, Plug, Plus, Power, RefreshCw, Search, Trash2 } from "lucide-react";
import { useJarvisStore } from "../store";
import { addMcp, removeMcp, syncMcps, toggleMcp } from "../hooks/useSocket";
import { SkeletonList } from "./ui";

type Filter = "all" | "enabled" | "disabled";

const PRESETS = [
  { name: "filesystem", command: "npx", args: "-y @modelcontextprotocol/server-filesystem C:/" },
  { name: "memory", command: "npx", args: "-y @modelcontextprotocol/server-memory" },
  { name: "sequential-thinking", command: "npx", args: "-y @modelcontextprotocol/server-sequential-thinking" },
  { name: "fetch", command: "npx", args: "-y @kazuph/mcp-fetch" },
  { name: "github", command: "npx", args: "-y @modelcontextprotocol/server-github" },
];

export function McpsTab() {
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const mcpServers = useJarvisStore((s) => s.mcpServers);
  const connected = useJarvisStore((s) => s.connected);
  const mcpError = useJarvisStore((s) => s.mcpError);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"stdio" | "http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [authFor, setAuthFor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => { if (mcpServers.length) setLoaded(true); }, [mcpServers.length]);
  const loading = !loaded && mcpServers.length === 0 && connected !== false;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mcpServers.filter((m: any) => {
      if (filter === "enabled" && !m.enabled) return false;
      if (filter === "disabled" && m.enabled) return false;
      if (needle && !`${m.label || ""} ${m.name} ${m.command || ""} ${m.url || ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [mcpServers, q, filter]);

  function submit() {
    if (mode === "stdio" ? !command.trim() : !url.trim()) return;
    addMcp({
      name: name.trim() || (mode === "http" ? "http-mcp" : command.trim()),
      transport: mode,
      command: mode === "stdio" ? command.trim() : "",
      args: mode === "stdio" ? args.trim() : "",
      url: mode === "http" ? url.trim() : "",
    }, activeFolder);
    setName(""); setCommand(""); setArgs(""); setUrl("");
  }

  return (
    <div className="h-full w-full overflow-y-auto p-4" style={{ scrollbarWidth: "none" }}>
      <div className="flex items-center gap-2 mb-4">
        <Plug className="h-4 w-4" style={{ color: "#f472b6" }} />
        <h2 className="font-mono text-[12px] tracking-[0.25em] uppercase text-white/90">MCP Servers</h2>
        <span className="font-mono text-[10px] text-muted-foreground">shared by every CLI + API provider</span>
        <button onClick={() => syncMcps()}
          className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md border transition-colors"
          style={{ color: "#f472b6", borderColor: "rgba(244,114,182,0.35)", background: "rgba(244,114,182,0.10)" }}
          title="Re-push the registry into every CLI's native config (repairs drift from hand-edits)">
          <RefreshCw className="h-3 w-3" /> Sync all
        </button>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) 360px" }}>
        {/* Installed servers */}
        <div className="glass-panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Installed ({shown.length}/{mcpServers.length})</div>
            <div className="flex items-center gap-1.5 ml-auto bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…"
                className="w-28 bg-transparent font-mono text-[10px] text-white/90 outline-none" />
            </div>
            {(["all", "enabled", "disabled"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className="font-mono text-[9px] px-2 py-1 rounded-md border capitalize"
                style={{ color: filter === f ? "#f472b6" : "#c9c9cc", borderColor: filter === f ? "#f472b666" : "rgba(255,255,255,0.08)" }}>{f}</button>
            ))}
          </div>
          {loading && <SkeletonList count={5} />}
          {!loading && mcpServers.length === 0 && <div className="text-muted-foreground font-mono text-[12px]">No MCP servers imported yet.</div>}
          {!loading && mcpServers.length > 0 && shown.length === 0 && <div className="text-muted-foreground font-mono text-[12px]">No servers match.</div>}
          <div className="flex flex-col gap-2">
            {!loading && shown.map((m: any) => {
              const envKeys = Object.keys(m.env || {});
              // A declared env var with no value is a server that cannot actually
              // connect — surface that as a labelled call to action rather than
              // hiding it behind the same anonymous key icon every row carries.
              const missing = envKeys.filter((k) => !String(m.env[k] || "").trim());
              const filled = envKeys.length - missing.length;
              const needsAuth = missing.length > 0;
              return (
                <div key={m.id} className="rounded-lg border p-3 relative overflow-hidden"
                  style={{
                    opacity: m.enabled ? 1 : 0.55,
                    borderColor: needsAuth ? "rgba(245,158,11,0.28)" : "rgba(255,255,255,0.06)",
                    background: needsAuth
                      ? "linear-gradient(180deg, rgba(245,158,11,0.07) 0%, rgba(245,158,11,0) 60%)"
                      : "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 70%)",
                  }}>
                  <div className="flex items-center gap-2">
                    <Plug className="h-3.5 w-3.5" style={{ color: m.enabled ? "#f472b6" : "#666" }} />
                    <span className="font-sans text-[13px] text-white/90">{m.label || m.name}</span>
                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "#9ca3af" }}>{m.transport}</span>
                    {filled > 0 && <span className="font-mono text-[9px]" style={{ color: "#10b981" }}>🔑 {filled} secret{filled > 1 ? "s" : ""}</span>}
                    {needsAuth ? (
                      <button onClick={() => setAuthFor(authFor === m.id ? null : m.id)}
                        className="ml-auto flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded-md border"
                        style={{ color: "#f59e0b", borderColor: "rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.12)" }}
                        title={`Needs ${missing.join(", ")}`}>
                        <KeyRound className="h-3 w-3" /> Authenticate
                      </button>
                    ) : (
                      <button onClick={() => setAuthFor(authFor === m.id ? null : m.id)} className="ml-auto grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Credentials (env vars / API keys)">
                        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                    <button onClick={() => toggleMcp(m.id, !m.enabled, activeFolder)} className="grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title={m.enabled ? "Disable" : "Enable"}>
                      <Power className="h-3.5 w-3.5" style={{ color: m.enabled ? "#10b981" : "#666" }} />
                    </button>
                    <button onClick={() => removeMcp(m.id, activeFolder)} className="grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Remove (purges from all CLI configs)">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground truncate mt-1">
                    {m.transport === "http" ? m.url : `${m.command} ${(m.args || []).join(" ")}`}
                  </div>
                  {authFor === m.id && <AuthEditor server={m} folder={activeFolder} onDone={() => setAuthFor(null)} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Import form */}
        <div className="glass-panel p-4 self-start">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Import a server</div>
          <div className="flex gap-1.5 mb-3">
            {(["stdio", "http"] as const).map((mo) => (
              <button key={mo} onClick={() => setMode(mo)} className="font-mono text-[10px] px-2.5 py-1 rounded-md border"
                style={{ color: mode === mo ? "#f472b6" : "#c9c9cc", borderColor: mode === mo ? "#f472b666" : "rgba(255,255,255,0.08)" }}>
                {mo === "stdio" ? "stdio (command)" : "http / sse"}
              </button>
            ))}
          </div>
          {mode === "stdio" && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => { setName(p.name); setCommand(p.command); setArgs(p.args); }}
                  className="font-mono text-[10px] px-2 py-1 rounded-md border border-white/[0.08] text-white/70 hover:border-white/20">{p.name}</button>
              ))}
            </div>
          )}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name"
            className="w-full mb-2 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
          {mode === "stdio" ? (
            <>
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command (npx)"
                className="w-full mb-2 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
              <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="args"
                className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
            </>
          ) : (
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse"
              className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
          )}
          {mcpError && <div className="mb-2 font-mono text-[11px]" style={{ color: "#f87171" }}>{mcpError}</div>}
          <button onClick={submit} className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg font-mono text-[11px] uppercase tracking-wider"
            style={{ background: "#f472b622", border: "1px solid #f472b666", color: "#f472b6" }}>
            <Plus className="h-3.5 w-3.5" /> Import & sync all CLIs
          </button>
        </div>
      </div>
    </div>
  );
}

/** Env-var / API-key editor. Re-imports the server (upsert) with the new secrets. */
function AuthEditor({ server, folder, onDone }: { server: any; folder: string; onDone: () => void }) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() => {
    const keys = Object.keys(server.env || {});
    return keys.length ? keys.map((k) => ({ k, v: server.env[k] })) : [{ k: "", v: "" }];
  });

  function save() {
    const env: Record<string, string> = {};
    for (const { k, v } of rows) if (k.trim()) env[k.trim()] = v;
    addMcp({
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: (server.args || []).join(" "),
      url: server.url,
      env,
    }, folder);
    onDone();
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06]">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-2">Environment secrets (API keys, tokens)</div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5 mb-1.5">
          <input value={r.k} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="KEY_NAME"
            className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1 font-mono text-[10px] text-white/90 outline-none" />
          <input type="password" value={r.v} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder="value"
            className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1 font-mono text-[10px] text-white/90 outline-none" />
        </div>
      ))}
      <div className="flex items-center gap-1.5 mt-2">
        <button onClick={() => setRows((rs) => [...rs, { k: "", v: "" }])} className="font-mono text-[10px] px-2 py-1 rounded-md border border-white/[0.08] text-white/60">+ add</button>
        <button onClick={save} className="ml-auto font-mono text-[10px] px-2.5 py-1 rounded-md" style={{ background: "#10b98122", border: "1px solid #10b98166", color: "#10b981" }}>Save & re-sync</button>
      </div>
    </div>
  );
}
