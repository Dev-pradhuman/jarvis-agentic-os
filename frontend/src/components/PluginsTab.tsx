import { useEffect, useMemo, useState } from "react";
import { Plus, Power, Trash2, Box, Search, Download, Check } from "lucide-react";
import { useJarvisStore } from "../store";
import {
  removePlugin, requestPlugins, togglePlugin,
  requestClaudePlugins, activateClaudePlugin, deactivateClaudePlugin, toggleClaudePlugin, scaffoldPlugin,
} from "../hooks/useSocket";
import { SkeletonGrid } from "./ui";

type Filter = "all" | "active" | "inactive";

export function PluginsTab() {
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const plugins = useJarvisStore((s) => s.plugins || []);
  const claudePlugins = useJarvisStore((s) => s.claudePlugins || []);
  const connected = useJarvisStore((s) => s.connected);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    requestPlugins(activeFolder);
    requestClaudePlugins(activeFolder);
  }, [activeFolder]);

  useEffect(() => { if (claudePlugins.length) setLoaded(true); }, [claudePlugins.length]);
  const loading = !loaded && claudePlugins.length === 0 && connected !== false;

  // Per-project filter view: search + active/inactive.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return claudePlugins.filter((p: any) => {
      if (filter === "active" && !p.activated) return false;
      if (filter === "inactive" && p.activated) return false;
      if (needle && !(`${p.label} ${p.description}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [claudePlugins, q, filter]);

  const activeCount = claudePlugins.filter((p: any) => p.activated).length;

  function submit() {
    if (!name.trim()) return;
    scaffoldPlugin(name.trim(), activeFolder); // creates a real plugin skeleton on disk
    setName("");
  }

  return (
    <div className="h-full w-full overflow-y-auto p-4" style={{ scrollbarWidth: "none" }}>
      <div className="flex items-center gap-2 mb-4">
        <Box className="h-4 w-4" style={{ color: "#22d3ee" }} />
        <h2 className="font-mono text-[12px] tracking-[0.25em] uppercase text-white/90">Plugins</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          Claude Code plugins — activate to share with every CLI + API {activeFolder ? `· ${activeFolder}` : "· all projects"}
        </span>
      </div>

      {/* Filter bar (per-project view) */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter plugins…"
            className="flex-1 bg-transparent font-mono text-[11px] text-white/90 outline-none" />
        </div>
        {(["all", "active", "inactive"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="font-mono text-[10px] px-2.5 py-1.5 rounded-md border capitalize"
            style={{ color: filter === f ? "#22d3ee" : "#c9c9cc", borderColor: filter === f ? "#22d3ee66" : "rgba(255,255,255,0.08)" }}>
            {f}
          </button>
        ))}
        <span className="font-mono text-[10px] text-muted-foreground">{activeCount}/{claudePlugins.length} active</span>
      </div>

      {/* Claude Code plugin catalog */}
      <div className="glass-panel p-4 mb-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
          Claude Code plugins ({loading ? "…" : shown.length})
        </div>
        {loading && <SkeletonGrid count={6} minWidth={320} />}
        {!loading && shown.length === 0 && <div className="text-muted-foreground font-mono text-[12px]">No plugins match.</div>}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {!loading && shown.map((p: any) => (
            <div key={p.id} className="rounded-lg border border-white/[0.06] p-3" style={{ opacity: p.activated && !p.enabled ? 0.55 : 1 }}>
              <div className="flex items-center gap-2">
                <Box className="h-3.5 w-3.5 shrink-0" style={{ color: p.activated ? "#22d3ee" : "#666" }} />
                <span className="font-sans text-[13px] text-white/90 truncate">{p.label}</span>
                {p.local && (
                  <span className="font-mono text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0"
                    style={{ color: "#f59e0b", background: "#f59e0b1a", border: "1px solid #f59e0b40" }}>mine</span>
                )}
                {p.activated && (
                  <button onClick={() => toggleClaudePlugin(p.id, !p.enabled, activeFolder)}
                    className="ml-auto grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title={p.enabled ? "Disable" : "Enable"}>
                    <Power className="h-3.5 w-3.5" style={{ color: p.enabled ? "#10b981" : "#666" }} />
                  </button>
                )}
                {p.activated ? (
                  <button onClick={() => deactivateClaudePlugin(p.id, activeFolder)}
                    className={`${p.activated ? "" : "ml-auto"} grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]`} title="Deactivate (remove its MCPs + skills)">
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ) : (
                  <button onClick={() => activateClaudePlugin(p.id, activeFolder)}
                    className="ml-auto flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-md border"
                    style={{ color: "#22d3ee", borderColor: "#22d3ee55", background: "#22d3ee14" }} title="Activate for every CLI + API">
                    <Download className="h-3 w-3" /> Activate
                  </button>
                )}
              </div>
              {p.description && <div className="font-mono text-[10px] text-muted-foreground mt-1 line-clamp-2">{p.description}</div>}
              <div className="flex items-center gap-2 mt-2 font-mono text-[9px] text-white/45">
                {p.counts.mcps > 0 && <span>🔌 {p.counts.mcps} mcp</span>}
                {p.counts.skills > 0 && <span>🧠 {p.counts.skills} skill</span>}
                {p.counts.commands > 0 && <span>⌘ {p.counts.commands} cmd</span>}
                {p.counts.agents > 0 && <span>🤖 {p.counts.agents} agent</span>}
                {p.activated && <span className="ml-auto flex items-center gap-1" style={{ color: "#10b981" }}><Check className="h-3 w-3" /> shared</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Jarvis plugins */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) 360px" }}>
        <div className="glass-panel p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Custom plugins ({plugins.length})</div>
          {plugins.length === 0 && <div className="text-muted-foreground font-mono text-[12px]">No custom plugins.</div>}
          <div className="flex flex-col gap-2">
            {plugins.map((m: any) => (
              <div key={m.id} className="rounded-lg border border-white/[0.06] p-3 flex items-center gap-2" style={{ opacity: m.enabled ? 1 : 0.55 }}>
                <Box className="h-3.5 w-3.5" style={{ color: m.enabled ? "#22d3ee" : "#666" }} />
                <span className="font-sans text-[13px] text-white/90">{m.label || m.name}</span>
                <button onClick={() => togglePlugin(m.id, !m.enabled, activeFolder)} className="ml-auto grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title={m.enabled ? "Disable" : "Enable"}>
                  <Power className="h-3.5 w-3.5" style={{ color: m.enabled ? "#10b981" : "#666" }} />
                </button>
                <button onClick={() => removePlugin(m.id, activeFolder)} className="grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Remove">
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel p-4 self-start">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Author your own plugin</div>
          <p className="font-mono text-[10px] text-white/45 mb-3 leading-relaxed">
            Scaffolds a real plugin in <span className="text-white/70">.jarvis-brain/plugins/</span> using the same
            format Claude Code uses — <span className="text-white/70">skills/</span>, <span className="text-white/70">commands/</span>,
            <span className="text-white/70"> .mcp.json</span>. Edit the files, hit Activate, and every CLI + API gets it.
          </p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-plugin"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20" />
          <button onClick={submit} className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg font-mono text-[11px] uppercase tracking-wider"
            style={{ background: "#22d3ee22", border: "1px solid #22d3ee66", color: "#22d3ee" }}>
            <Plus className="h-3.5 w-3.5" /> New plugin
          </button>
        </div>
      </div>
    </div>
  );
}
