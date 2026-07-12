import { FolderGit2, MessagesSquare } from "lucide-react";
import { useJarvisStore } from "../store";
import { JarvisDashboard } from "./JarvisDashboard";

/**
 * Projects tab = the live command deck (3D core + vitals + terminal) plus a strip
 * of project folders. Each folder is a sub-brain; clicking one drops you into its
 * chats. This preserves the flagship dashboard while making it the "home" tab.
 */
export function ProjectsTab() {
  const folders = useJarvisStore((s) => s.folders);
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const setActiveFolder = useJarvisStore((s) => s.setActiveFolder);
  const setView = useJarvisStore((s) => s.setView);
  const addPane = useJarvisStore((s) => s.addPane);
  const clis = useJarvisStore((s) => s.clis);

  function open(folder: string) {
    setActiveFolder(folder);
    const first = clis.find((c: any) => c.available);
    if (first) addPane(first.id); // also sets view = 'chats'
    else setView("chats");
  }

  return (
    <div className="h-full w-full flex flex-col gap-3 p-3">
      {/* Project folder strip */}
      <div className="glass-panel px-3 py-2.5 flex items-center gap-2 overflow-x-auto shrink-0" style={{ scrollbarWidth: "none" }}>
        <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/80 mr-1 shrink-0">Projects</span>
        <button onClick={() => open("")} className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border shrink-0 flex items-center gap-1.5"
          style={{ color: activeFolder === "" ? "#c4b5fd" : "#c9c9cc", borderColor: activeFolder === "" ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.08)", background: activeFolder === "" ? "rgba(139,92,246,0.1)" : "transparent" }}>
          main brain
        </button>
        {folders.map((f: string) => (
          <button key={f} onClick={() => open(f)}
            className="font-mono text-[11px] px-2.5 py-1.5 rounded-lg border shrink-0 flex items-center gap-1.5 hover:border-white/20"
            style={{ color: activeFolder === f ? "#c4b5fd" : "#c9c9cc", borderColor: activeFolder === f ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.08)", background: activeFolder === f ? "rgba(139,92,246,0.1)" : "transparent" }}
            title={`Open ${f} chats`}>
            {f}
            <MessagesSquare className="h-3 w-3 opacity-50" />
          </button>
        ))}
      </div>

      {/* Flagship live dashboard */}
      <div className="flex-1 min-h-0">
        <JarvisDashboard />
      </div>
    </div>
  );
}
