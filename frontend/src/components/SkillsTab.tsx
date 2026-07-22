import { useEffect, useMemo, useState } from "react";
import { FileCode2, Pencil, Play, Plus, Power, Save, Search, Trash2, X, Zap } from "lucide-react";
import { useJarvisStore } from "../store";
import { deleteSkill, readSkill, requestSkills, saveSkill, sendSkill, toggleSkill } from "../hooks/useSocket";
import { SkeletonGrid } from "./ui";

function relTime(ms?: number) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function SkillsTab() {
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const skills = useJarvisStore((s) => s.skills);
  const connected = useJarvisStore((s) => s.connected);
  const activeSkills = useJarvisStore((s) => s.activeSkills);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");

  useEffect(() => { requestSkills(activeFolder); }, [activeFolder]);
  // Distinguish "still loading" from a genuinely empty list, so we don't flash
  // "no skills" at the user while the socket round-trip is still in flight.
  useEffect(() => { if (skills.length) setLoaded(true); }, [skills.length]);
  const loading = !loaded && skills.length === 0 && connected !== false;

  const runState = (id: string) => activeSkills.find((s: any) => s.skillId === id);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return skills.filter((s: any) => {
      if (filter === "enabled" && !s.enabled) return false;
      if (filter === "disabled" && s.enabled) return false;
      if (needle && !`${s.label} ${s.id} ${s.preview || ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [skills, q, filter]);

  return (
    <div className="h-full w-full overflow-y-auto p-4" style={{ scrollbarWidth: "none" }}>
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4" style={{ color: "#8b5cf6" }} />
        <h2 className="font-mono text-[12px] tracking-[0.25em] uppercase text-white/90">Skills</h2>
        <span className="font-mono text-[10px] text-muted-foreground">{shown.length}/{skills.length} SOPs · real files in the vault</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…"
              className="w-28 bg-transparent font-mono text-[10px] text-white/90 outline-none" />
          </div>
          {(["all", "enabled", "disabled"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className="font-mono text-[9px] px-2 py-1 rounded-md border capitalize"
              style={{ color: filter === f ? "#8b5cf6" : "#c9c9cc", borderColor: filter === f ? "#8b5cf666" : "rgba(255,255,255,0.08)" }}>{f}</button>
          ))}
          <button onClick={() => setEditing("__new__")}
            className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed flex items-center gap-1"
            style={{ color: "#8b5cf6", borderColor: "#8b5cf655" }}>
            <Plus className="h-3 w-3" /> New skill
          </button>
        </div>
      </div>

      {loading && <SkeletonGrid count={6} minWidth={300} />}

      {!loading && (
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {shown.map((s: any) => {
          const rs = runState(s.id);
          return (
            <div key={s.id} className="glass-panel p-4 flex flex-col gap-2" style={{ opacity: s.enabled ? 1 : 0.55 }}>
              <div className="flex items-center gap-2">
                <FileCode2 className="h-4 w-4 shrink-0" style={{ color: s.enabled ? "#a78bfa" : "#666" }} />
                <div className="font-sans text-[13px] text-white/90 truncate">{s.label}</div>
                <button onClick={() => toggleSkill(s.id, !s.enabled, activeFolder)} className="ml-auto grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title={s.enabled ? "Disable" : "Enable"}>
                  <Power className="h-3.5 w-3.5" style={{ color: s.enabled ? "#10b981" : "#666" }} />
                </button>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground truncate">{s.file}</div>
              <p className="font-mono text-[10px] text-white/50 leading-[1.5] line-clamp-3 h-[42px] overflow-hidden">{s.preview}</p>
              <div className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                <span>{(s.bytes / 1024).toFixed(1)} KB</span>
                <span>· {relTime(s.updated)}</span>
                {s.registered && <span style={{ color: "#8b5cf6" }}>· voice-routable</span>}
                {rs && <span style={{ color: rs.status === "RUNNING" ? "#10b981" : rs.status === "FAILED" ? "#f87171" : "#87878a" }}>· {rs.status}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <button onClick={() => sendSkill(s.id)} disabled={!s.enabled}
                  className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-md border disabled:opacity-35"
                  style={{ color: "#10b981", borderColor: "#10b98144" }}>
                  <Play className="h-3 w-3" /> Run
                </button>
                <button onClick={() => setEditing(s.id)}
                  className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-md border border-white/[0.08] text-white/70">
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                <button onClick={() => { if (confirm(`Delete skill ${s.id}? This removes the SOP file.`)) deleteSkill(s.id, activeFolder); }}
                  className="ml-auto grid place-items-center h-6 w-6 rounded hover:bg-white/[0.05]" title="Delete SOP">
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            </div>
          );
        })}
        {skills.length === 0 && <div className="text-muted-foreground font-mono text-[12px]">No skills found in the vault.</div>}
        {skills.length > 0 && shown.length === 0 && <div className="text-muted-foreground font-mono text-[12px]">No skills match the filter.</div>}
      </div>
      )}

      {editing && <SkillEditor id={editing} folder={activeFolder} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SkillEditor({ id, folder, onClose }: { id: string; folder: string; onClose: () => void }) {
  const isNew = id === "__new__";
  const skillContent = useJarvisStore((s) => s.skillContent);
  const setSkillContent = useJarvisStore((s) => s.setSkillContent);
  const [skillId, setSkillId] = useState(isNew ? "SKILL_" : id);
  const [content, setContent] = useState(isNew ? "# New Skill\n\n## Objective\n\n## Steps\n1. \n\n## Output\n🔊 " : "");

  useEffect(() => {
    if (!isNew) { setSkillContent(null); readSkill(id); }
    return () => setSkillContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!isNew && skillContent && skillContent.id === id) setContent(skillContent.content);
  }, [skillContent, id, isNew]);

  function save() {
    const finalId = skillId.trim();
    if (!finalId) return;
    saveSkill(finalId, content, folder);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="glass-panel w-[720px] max-w-[94vw] p-5 flex flex-col" style={{ maxHeight: "86vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4" style={{ color: "#a78bfa" }} />
            <span className="font-mono text-[12px] tracking-[0.2em] uppercase text-white/90">{isNew ? "New Skill" : "Edit Skill"}</span>
          </div>
          <button onClick={onClose} className="grid place-items-center h-7 w-7 rounded-md hover:bg-white/[0.05]"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Skill ID (filename)</label>
        <input value={skillId} onChange={(e) => setSkillId(e.target.value)} disabled={!isNew} placeholder="SKILL_MY_TASK"
          className="w-full mb-3 bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/90 outline-none focus:border-white/20 disabled:opacity-50" />
        <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">SOP (markdown)</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          className="flex-1 min-h-[320px] w-full mb-3 resize-none bg-black/30 border border-white/[0.08] rounded-md px-3 py-2 font-mono text-[12px] text-white/85 outline-none focus:border-white/20 leading-[1.55]" />
        <div className="flex items-center justify-end gap-2">
          <button onClick={save} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-mono text-[11px] uppercase tracking-wider"
            style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.4)", color: "#c4b5fd" }}>
            <Save className="h-3.5 w-3.5" /> Save SOP
          </button>
        </div>
      </div>
    </div>
  );
}
