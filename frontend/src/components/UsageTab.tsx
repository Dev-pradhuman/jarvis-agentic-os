import { useEffect } from "react";
import { Activity, Clock, Coins, Cpu, HardDrive, Hash, TrendingUp } from "lucide-react";
import { useJarvisStore } from "../store";
import { requestUsage } from "../hooks/useSocket";
import { agentColor, agentLabel } from "./shared";

function fmtNum(n?: number) {
  if (n == null) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function fmtDur(ms?: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function Stat({ icon: Icon, label, value, sub, color = "#8b5cf6" }: any) {
  return (
    <div className="glass-panel p-4 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      </div>
      <div className="font-sans text-[22px] text-white/95 leading-tight">{value}</div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function UsageTab() {
  const usage = useJarvisStore((s) => s.usage);
  const tokens = useJarvisStore((s) => s.liveState?.tokens) as number[] | undefined;

  useEffect(() => { requestUsage(); }, []);

  const live = usage?.live;
  const totals = usage?.totals;
  const agents = usage?.agents ?? [];
  const memPct = live ? Math.round(((live.totalMemMb - live.freeMemMb) / live.totalMemMb) * 100) : 0;
  const maxTok = Math.max(1, ...(tokens ?? [0]));

  return (
    <div className="h-full w-full overflow-y-auto p-4" style={{ scrollbarWidth: "none" }}>
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4" style={{ color: "#22d3ee" }} />
        <h2 className="font-mono text-[12px] tracking-[0.25em] uppercase text-white/90">Usage</h2>
        <span className="font-mono text-[10px] text-muted-foreground">live — aggregated from the shared brain</span>
      </div>

      {/* Live telemetry + totals */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        <Stat icon={Cpu} label="CPU" value={`${live?.cpuPct ?? 0}%`} sub={`${live?.cores ?? 0} cores`} color="#22d3ee" />
        <Stat icon={HardDrive} label="Memory" value={`${live?.rssMb ?? 0}MB`} sub={`system ${memPct}% used`} color="#10b981" />
        <Stat icon={Activity} label="Agents live" value={String(live?.agentsRunning ?? 0).padStart(2, "0")} sub={`uptime ${Math.round((live?.uptimeSec ?? 0) / 60)}m`} color="#f59e0b" />
        <Stat icon={Hash} label="Total runs" value={fmtNum(totals?.runs)} sub={`${agents.length} agents`} color="#8b5cf6" />
        <Stat icon={Coins} label="Tokens" value={fmtNum(totals?.tokens)} sub="≈ 4 chars/token" color="#a78bfa" />
        <Stat icon={TrendingUp} label="Est. cost" value={`$${(totals?.cost ?? 0).toFixed(3)}`} sub="API only · local=$0" color="#ec4899" />
        <Stat icon={Clock} label="Avg exec" value={fmtDur(totals?.avgDurationMs)} sub="per timed run" color="#3b82f6" />
      </div>

      {/* Token throughput sparkline (live series) */}
      <div className="glass-panel p-4 mb-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Token throughput (live)</div>
        <div className="flex items-end gap-1 h-[80px]">
          {(tokens ?? []).map((t, i) => (
            <div key={i} className="flex-1 rounded-t" style={{ height: `${(t / maxTok) * 100}%`, minHeight: 2, background: "linear-gradient(to top, #8b5cf6, #22d3ee)", opacity: 0.4 + (i / (tokens?.length || 1)) * 0.6 }} />
          ))}
        </div>
      </div>

      {/* Per-agent breakdown */}
      <div className="glass-panel p-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Per-agent breakdown</div>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1.5 pr-3 font-normal">Agent</th>
                <th className="py-1.5 pr-3 font-normal text-right">Runs</th>
                <th className="py-1.5 pr-3 font-normal text-right">Tokens</th>
                <th className="py-1.5 pr-3 font-normal text-right">Est. cost</th>
                <th className="py-1.5 pr-3 font-normal text-right">Avg exec</th>
                <th className="py-1.5 pr-3 font-normal text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a: any) => (
                <tr key={a.id} className="border-t border-white/[0.05]">
                  <td className="py-2 pr-3">
                    <span className="px-1.5 py-0.5 rounded uppercase tracking-wider text-[10px]" style={{ color: agentColor(a.id), background: `${agentColor(a.id)}1a`, border: `1px solid ${agentColor(a.id)}40` }}>
                      {agentLabel(a.id)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right text-white/85">{a.runs}</td>
                  <td className="py-2 pr-3 text-right text-white/85">{fmtNum(a.tokens)}</td>
                  <td className="py-2 pr-3 text-right text-white/85">${a.cost.toFixed(3)}</td>
                  <td className="py-2 pr-3 text-right text-white/85">{fmtDur(a.avgDurationMs)}</td>
                  <td className="py-2 pr-3 text-right" style={{ color: a.errors ? "#f87171" : "#4b5563" }}>{a.errors}</td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No runs recorded yet — send a chat to start collecting usage.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
