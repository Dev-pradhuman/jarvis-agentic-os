import { useEffect, useState } from "react";
import { X, TerminalSquare, Play, Save, RotateCcw } from "lucide-react";
import { useJarvisStore } from "../store";
import { openTerminal, requestCliCommands, setCliCommand } from "../hooks/useSocket";
import { agentColor } from "./shared";

/**
 * Per-CLI terminal commands. Each row is an editable command (login / launch /
 * anything) with a one-click "Run" that opens a REAL console window running it in
 * the active project folder — the way to complete interactive logins (codex login,
 * opencode auth login, device-auth prompts) that the piped chat path can't do.
 */
export function CliCommandsModal({ onClose }: { onClose: () => void }) {
  const clis = useJarvisStore((s) => s.clis);
  const cliCommands = useJarvisStore((s) => s.cliCommands);
  const activeFolder = useJarvisStore((s) => s.activeFolder);

  useEffect(() => { requestCliCommands(); }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="glass-panel w-[620px] max-w-[94vw] p-5 flex flex-col" style={{ maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4" style={{ color: "#34d399" }} />
            <span className="font-mono text-[12px] tracking-[0.2em] uppercase text-white/90">CLI Terminal Commands</span>
          </div>
          <button onClick={onClose} className="grid place-items-center h-7 w-7 rounded-md hover:bg-white/[0.05]">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <p className="font-mono text-[10px] text-white/45 mb-4 leading-relaxed">
          Edit each command, then <span className="text-white/70">Run</span> to open a real terminal in
          {activeFolder ? ` "${activeFolder}"` : " the main folder"}. Use this for logins (e.g. <span className="text-white/70">codex login</span>) or launching a CLI interactively.
        </p>

        <div className="flex flex-col gap-3 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {clis.map((c: any) => (
            <CommandRow key={c.id} cli={c} value={cliCommands[c.id] ?? c.setupCmd ?? ""} folder={activeFolder} />
          ))}
          {clis.length === 0 && <div className="font-mono text-[11px] text-white/40">No CLIs detected.</div>}
        </div>
      </div>
    </div>
  );
}

function CommandRow({ cli, value, folder }: { cli: any; value: string; folder: string }) {
  const color = agentColor(cli.id);
  const [cmd, setCmd] = useState(value);
  const [saved, setSaved] = useState(false);

  // Keep the field in sync if the backend pushes an update (e.g. after reset).
  useEffect(() => { setCmd(value); }, [value]);

  const dirty = cmd !== value;

  function save() {
    setCliCommand(cli.id, cmd);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }
  function reset() {
    setCliCommand(cli.id, ""); // empty resets to the CLI's default
  }
  function run() {
    if (dirty) setCliCommand(cli.id, cmd); // persist edits before running
    openTerminal(cli.id, folder, cmd);
  }

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
          style={{ color, background: `${color}1a`, border: `1px solid ${color}40` }}>
          {cli.label}
        </span>
        {!cli.available && <span className="font-mono text-[10px] text-amber-400/80">not installed</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          spellCheck={false}
          className="flex-1 bg-black/40 border border-white/[0.08] rounded-md px-2 py-1.5 font-mono text-[11px] text-white/90 outline-none focus:border-white/25"
          placeholder={cli.cmd}
        />
        <button onClick={run} disabled={!cli.available} title="Open terminal & run"
          className="flex items-center gap-1 font-mono text-[11px] px-2.5 py-1.5 rounded-md border disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ color: "#34d399", borderColor: "#34d39955", background: "#34d39914" }}>
          <Play className="h-3 w-3" /> Run
        </button>
        <button onClick={save} disabled={!dirty} title="Save command"
          className="grid place-items-center h-[30px] w-[30px] rounded-md border border-white/[0.08] hover:bg-white/[0.05] disabled:opacity-30">
          {saved ? <span className="text-[9px] text-emerald-400">✓</span> : <Save className="h-3.5 w-3.5 text-white/70" />}
        </button>
        <button onClick={reset} title="Reset to default"
          className="grid place-items-center h-[30px] w-[30px] rounded-md border border-white/[0.08] hover:bg-white/[0.05]">
          <RotateCcw className="h-3.5 w-3.5 text-white/60" />
        </button>
      </div>
    </div>
  );
}
