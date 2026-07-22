import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Box, CornerDownLeft, FolderGit2, Hash, MessageSquare, Play, Plug, RefreshCw, Search, Square, Terminal, Zap } from "lucide-react";
import { useJarvisStore } from "../store";
import { analyzeFolder, openTerminal, searchBrain, sendSkill, setRuflow, stopAll, syncMcps } from "../hooks/useSocket";
import { agentColor } from "./shared";

type Action = { id: string; label: string; hint?: string; icon: any; color?: string; run: () => void };

/**
 * Subsequence match with a score, so "gp" finds "Go to Plugins" and "ocl" finds
 * "Open chat · Claude" — a substring filter can't, and typing the exact words is
 * the slow path this palette exists to avoid. Score rewards hits that start a word
 * and hits that land close together, so the tightest match sorts first.
 */
function fuzzy(label: string, needle: string): number | null {
  const hay = label.toLowerCase();
  let i = 0;
  let score = 0;
  let last = -1;
  for (const ch of needle) {
    const at = hay.indexOf(ch, i);
    if (at === -1) return null;
    if (at === 0 || /[\s·\-_/]/.test(hay[at - 1])) score += 10; // word start
    if (last >= 0 && at === last + 1) score += 5; // contiguous run
    score -= Math.min(at - i, 6); // distance penalty
    last = at;
    i = at + 1;
  }
  return score;
}

export function CommandPalette() {
  const open = useJarvisStore((s) => s.paletteOpen);
  const setOpen = useJarvisStore((s) => s.setPaletteOpen);
  const setView = useJarvisStore((s) => s.setView);
  const setActiveFolder = useJarvisStore((s) => s.setActiveFolder);
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const addPane = useJarvisStore((s) => s.addPane);
  const folders = useJarvisStore((s) => s.folders);
  const clis = useJarvisStore((s) => s.clis);
  const providers = useJarvisStore((s) => s.providers);
  const skills = useJarvisStore((s) => s.skills);
  const results = useJarvisStore((s) => s.searchResults);
  const setSearchResults = useJarvisStore((s) => s.setSearchResults);

  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setSearchResults([]);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open, setSearchResults]);

  // Debounced brain search once the query is meaningful.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => searchBrain(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q, open, setSearchResults]);

  const go = (fn: () => void) => { fn(); setOpen(false); };

  const actions: Action[] = useMemo(() => {
    const a: Action[] = [
      { id: "t-projects", label: "Go to Projects", icon: FolderGit2, run: () => setView("projects") },
      { id: "t-chats", label: "Go to Chats", icon: MessageSquare, run: () => setView("chats") },
      { id: "t-skills", label: "Go to Skills", icon: Zap, run: () => setView("skills") },
      { id: "t-mcps", label: "Go to MCPs", icon: Plug, run: () => setView("mcps") },
      { id: "t-plugins", label: "Go to Plugins", icon: Box, run: () => setView("plugins") },
      { id: "t-usage", label: "Go to Usage", icon: Activity, run: () => setView("usage") },
      { id: "stop-all", label: "Stop all agents", hint: "kill switch", icon: Square, color: "#ef4444", run: () => stopAll() },
      { id: "mcp-sync", label: "Sync MCPs to every CLI config", hint: "repair", icon: RefreshCw, color: "#f472b6", run: () => syncMcps() },
      {
        id: "analyze-folder", hint: "brain", icon: RefreshCw, color: "#a78bfa",
        label: activeFolder ? `Re-analyze project · ${activeFolder}` : "Re-analyze all projects",
        run: () => analyzeFolder(activeFolder),
      },
      {
        id: "ruflow-on", label: "Ruflow · token-lean mode ON", hint: "cheaper", icon: Zap, color: "#10b981",
        run: () => setRuflow(true, activeFolder),
      },
      {
        id: "ruflow-off", label: "Ruflow · token-lean mode OFF", hint: "verbose", icon: Zap, color: "#f59e0b",
        run: () => setRuflow(false, activeFolder),
      },
    ];
    for (const c of clis) {
      if (!c.available) continue;
      a.push({ id: `agent-${c.id}`, label: `Open chat · ${c.label}`, hint: "tile", icon: Terminal, color: agentColor(c.id), run: () => addPane(c.id) });
      // The one-click console — same command the Projects tab launches.
      a.push({ id: `term-${c.id}`, label: `Open terminal · ${c.label}`, hint: "console", icon: Terminal, color: agentColor(c.id), run: () => openTerminal(c.id, activeFolder) });
    }
    for (const p of providers) {
      a.push({ id: `agent-api-${p.id}`, label: `Open chat · ${p.label}`, hint: "API", icon: Zap, color: "#22d3ee", run: () => addPane(`api:${p.id}`) });
    }
    for (const f of folders) {
      a.push({ id: `proj-${f}`, label: `Open project · ${f}`, hint: "sub-brain", icon: FolderGit2, color: "#a78bfa", run: () => { setActiveFolder(f); setView("chats"); } });
    }
    for (const sk of skills) {
      if (sk.enabled === false) continue;
      a.push({ id: `skill-${sk.id}`, label: `Run skill · ${sk.label}`, hint: "SOP", icon: Play, color: "#10b981", run: () => sendSkill(sk.id) });
    }
    return a;
  }, [clis, providers, folders, skills, setView, setActiveFolder, addPane, activeFolder]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions
      .map((x) => ({ x, s: fuzzy(x.label, needle) }))
      .filter((r): r is { x: Action; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.x);
  }, [actions, q]);

  // Flat list: actions first, then brain search hits.
  const items = useMemo(() => {
    const searchItems = (q.trim().length >= 2 ? results : []).map((r: any, i: number) => ({
      id: `search-${i}`,
      kind: "search" as const,
      r,
    }));
    return [
      ...filtered.map((a) => ({ id: a.id, kind: "action" as const, a })),
      ...searchItems,
    ];
  }, [filtered, results, q]);

  useEffect(() => { setSel(0); }, [q, results]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${sel}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function runItem(it: (typeof items)[number]) {
    if (it.kind === "action") return go(it.a.run);
    const r = it.r;
    go(() => {
      setActiveFolder(r.folder || "");
      setView("chats");
      if (r.type === "chat" && r.agent && clis.some((c: any) => c.id === r.agent)) addPane(r.agent);
    });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) runItem(items[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh]" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }} onClick={() => setOpen(false)}>
      <div className="glass-panel w-[620px] max-w-[92vw] overflow-hidden flex flex-col" style={{ maxHeight: "70vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3.5 py-3 border-b border-white/[0.07]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search chats & notes, or jump to a tab, project, agent, skill…"
            className="flex-1 bg-transparent outline-none font-mono text-[13px] text-white/90 placeholder:text-muted-foreground"
          />
          <span className="font-mono text-[10px] text-muted-foreground border border-white/[0.1] rounded px-1.5 py-0.5">esc</span>
        </div>

        <div ref={listRef} className="overflow-y-auto py-1.5" style={{ scrollbarWidth: "none" }}>
          {items.length === 0 && <div className="px-4 py-6 text-center font-mono text-[12px] text-muted-foreground">No matches.</div>}

          {items.map((it, i) => {
            const active = i === sel;
            const base = "flex items-center gap-2.5 px-3.5 py-2 cursor-pointer";
            const bg = active ? "rgba(139,92,246,0.14)" : "transparent";
            if (it.kind === "action") {
              const A = it.a;
              return (
                <div key={it.id} data-i={i} className={base} style={{ background: bg }} onMouseEnter={() => setSel(i)} onClick={() => runItem(it)}>
                  <A.icon className="h-3.5 w-3.5 shrink-0" style={{ color: A.color || "#a78bfa" }} />
                  <span className="font-sans text-[13px] text-white/90 flex-1 truncate">{A.label}</span>
                  {A.hint && <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">{A.hint}</span>}
                  {active && <CornerDownLeft className="h-3 w-3 text-muted-foreground" />}
                </div>
              );
            }
            const r = it.r;
            const color = r.type === "chat" ? agentColor(r.agent || "") : "#a78bfa";
            return (
              <div key={it.id} data-i={i} className={base} style={{ background: bg }} onMouseEnter={() => setSel(i)} onClick={() => runItem(it)}>
                <Hash className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-white/85 truncate">{r.snippet}</div>
                  <div className="font-mono text-[9px] text-muted-foreground">
                    {r.type === "chat" ? `chat · ${r.agent} · ${r.folder || "main"}` : `note · ${r.folder || "main brain"}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-3.5 py-2 border-t border-white/[0.07] flex items-center gap-3 font-mono text-[9px] text-muted-foreground">
          <span>↑↓ navigate</span><span>⏎ open</span><span>esc close</span>
          <span className="ml-auto">{items.length} result{items.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
