import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDot, ClipboardCheck, FileDiff, HeartPulse, Play, Plus, Send, ShieldCheck } from 'lucide-react';
import { useJarvisStore } from '../store';
import { createMission as createMissionRequest, decideApproval, requestApprovals, requestMissions, requestOperationsHealth, requestReviewEvidence, sendChat, updateMission as updateMissionRequest } from '../hooks/useSocket';
import { agentColor, agentLabel } from './shared';

const STAGES = ['Research', 'Plan', 'Implement', 'Review', 'Test'];
const DEFAULTS: Record<string, string> = { Research: 'gemini', Plan: 'claude', Implement: 'codex', Review: 'claude', Test: 'codex' };

export function OperationsTab() {
  const clis = useJarvisStore((s) => s.clis);
  const providers = useJarvisStore((s) => s.providers);
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const activity = useJarvisStore((s) => s.agentActivity);
  const sessions = useJarvisStore((s) => s.chatSessions);
  const missions = useJarvisStore((s) => s.missions);
  const connected = useJarvisStore((s) => s.connected);
  const operationsHealth = useJarvisStore((s) => s.operationsHealth);
  const reviewEvidence = useJarvisStore((s) => s.reviewEvidence);
  const approvals = useJarvisStore((s) => s.approvals);
  const routingProfiles = useJarvisStore((s) => s.routingProfiles);
  const mcp = useJarvisStore((s) => s.mcpServers);
  const [title, setTitle] = useState('');
  useEffect(() => { requestOperationsHealth(); requestReviewEvidence(activeFolder); requestApprovals(); requestMissions(activeFolder); }, [activeFolder]);
  const agents = useMemo(() => [...clis.filter((x: any) => x.available).map((x: any) => x.id), ...providers.map((x: any) => `api:${x.id}`)], [clis, providers]);
  function createMission() {
    if (!title.trim()) return;
    createMissionRequest(title.trim(), activeFolder);
    setTitle('');
  }
  function runStage(m: any) {
    const stage = STAGES[m.stage]; const preferred = routingProfiles[stage]?.preferred || DEFAULTS[stage]; const fallback = routingProfiles[stage]?.fallback;
    const cliId = agents.includes(preferred) ? preferred : agents.includes(fallback) ? fallback : agents[0];
    if (!cliId) return;
    sendChat({ cliId, model: '', effort: stage === 'Implement' ? 'high' : 'medium', folder: m.folder, missionId: m.id, missionStage: stage, prompt: `[Mission: ${m.title}] You own the ${stage} stage. Read the shared brain, do this stage, record decisions and hand off a concise result to the next stage.` });
    updateMissionRequest(m.id, { status: 'running', assigned: cliId, note: `${stage} assigned to ${cliId}` }, activeFolder);
  }
  function advance(m: any) { updateMissionRequest(m.id, { stage: Math.min(m.stage + 1, STAGES.length - 1), status: m.stage >= STAGES.length - 1 ? 'done' : 'ready', note: 'Stage marked complete' }, activeFolder); }
  const health = [
    { label: 'Orchestrator', ok: connected, note: connected ? 'connected' : 'offline' },
    { label: 'CLIs', ok: clis.some((x: any) => x.available), note: `${clis.filter((x: any) => x.available).length} available` },
    { label: '9Router', ok: !!operationsHealth?.services?.router9?.ok, note: operationsHealth?.services?.router9?.ok ? 'reachable' : 'offline' },
    { label: 'Voice', ok: !!operationsHealth?.services?.stt?.ok && !!operationsHealth?.services?.tts?.ok, note: `STT ${operationsHealth?.services?.stt?.ok ? 'on' : 'off'} · TTS ${operationsHealth?.services?.tts?.ok ? 'on' : 'off'}` },
    { label: 'Providers', ok: providers.length > 0, note: providers.length ? `${providers.length} configured` : 'none configured' },
    { label: 'MCPs', ok: mcp.every((x: any) => x.enabled), note: `${mcp.filter((x: any) => x.enabled).length} enabled` },
  ];
  return <div className="h-full overflow-y-auto p-5" style={{ scrollbarWidth: 'none' }}>
    <header className="mb-5 flex items-end justify-between border-b border-[#29332f] pb-4"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#d8ff5e]">Operations</p><h1 className="mt-1 text-2xl font-semibold">One place for work in flight.</h1></div><span className="font-mono text-[10px] text-muted-foreground">{activeFolder || 'all projects'}</span></header>
    <div className="grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
      <section className="glass-panel p-4"><div className="flex items-center gap-2"><CircleDot className="h-4 w-4 text-[#d8ff5e]"/><h2 className="font-mono text-xs uppercase tracking-wider">Mission pipeline</h2></div><div className="mt-4 flex gap-2"><input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createMission()} placeholder="Describe the outcome you want" className="flex-1 rounded-md border border-[#29332f] bg-[#101413] px-3 py-2 text-sm outline-none focus:border-[#d8ff5e]"/><button onClick={createMission} className="rounded-md bg-[#d8ff5e] px-3 text-[#101413]" title="Create mission"><Plus className="h-4 w-4"/></button></div><div className="mt-4 space-y-2">{missions.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Create a mission to run Research → Plan → Implement → Review → Test.</p>}{missions.map((m: any) => <div key={m.id} className="rounded-md border border-[#29332f] p-3"><div className="flex items-center justify-between"><b className="text-sm">{m.title}</b><span className="font-mono text-[10px] text-[#d8ff5e]">{STAGES[m.stage]}</span></div><div className="mt-3 flex gap-1">{STAGES.map((x, i) => <span key={x} className="h-1 flex-1 rounded" style={{ background: i <= m.stage ? '#d8ff5e' : '#29332f' }}/>)}</div><div className="mt-2 font-mono text-[10px] text-muted-foreground">Route: {routingProfiles[STAGES[m.stage]]?.preferred || DEFAULTS[STAGES[m.stage]]} · {routingProfiles[STAGES[m.stage]]?.reason || 'default'}</div><div className="mt-3 flex gap-2"><button onClick={() => runStage(m)} className="flex items-center gap-1 rounded border border-[#d8ff5e] px-2 py-1 font-mono text-[10px] text-[#d8ff5e]"><Play className="h-3 w-3"/>Run {STAGES[m.stage]}</button><button onClick={() => advance(m)} className="rounded px-2 py-1 font-mono text-[10px] text-muted-foreground">Mark complete →</button></div>{m.history?.slice(-2).reverse().map((h: any) => <p key={h.at} className="mt-2 border-t border-[#29332f] pt-2 text-[10px] text-muted-foreground">{h.text}</p>)}</div>)}</div></section>
      <section className="space-y-4"><div className="glass-panel p-4"><div className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-[#d8ff5e]"/><h2 className="font-mono text-xs uppercase tracking-wider">Setup health</h2></div><div className="mt-3 space-y-2">{health.map((h) => <div key={h.label} className="flex items-center justify-between border-b border-[#29332f] pb-2 text-sm"><span>{h.label}</span><span className={h.ok ? 'text-[#d8ff5e]' : 'text-[#ffb4a8]'}>{h.note}</span></div>)}</div></div><div className="glass-panel p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#d8ff5e]"/><h2 className="font-mono text-xs uppercase tracking-wider">Approval queue</h2></div><div className="mt-3 space-y-2">{approvals.filter((x: any) => x.status === 'pending').map((x: any) => <div key={x.id} className="border-b border-[#29332f] pb-2 text-sm"><b>{x.type === 'mcp' ? 'MCP import' : 'Terminal launch'}</b><p className="mt-1 truncate text-xs text-muted-foreground">{x.type === 'mcp' ? (x.payload.label || x.payload.name || x.payload.command) : x.payload.command}</p><button onClick={() => decideApproval(x.id, true)} className="mr-2 mt-2 rounded bg-[#d8ff5e] px-2 py-1 text-[10px] text-[#101413]">Approve</button><button onClick={() => decideApproval(x.id, false)} className="mt-2 rounded border border-[#29332f] px-2 py-1 text-[10px]">Reject</button></div>)}{!approvals.some((x: any) => x.status === 'pending') && <p className="mt-3 text-sm text-muted-foreground">No pending approvals.</p>}</div></div></section>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2"><section className="glass-panel p-4"><div className="flex items-center gap-2"><Send className="h-4 w-4 text-[#d8ff5e]"/><h2 className="font-mono text-xs uppercase tracking-wider">Agent task board</h2></div><div className="mt-3 space-y-2">{activity.length === 0 ? <p className="text-sm text-muted-foreground">No agents are working right now.</p> : activity.map((a: any) => <div key={a.chatId} className="border-l-2 pl-3" style={{ borderColor: agentColor(a.cli) }}><div className="text-sm">{agentLabel(a.cli)}</div><div className="text-xs text-muted-foreground">{a.prompt}</div></div>)}</div></section><section className="glass-panel p-4"><div className="flex items-center gap-2"><FileDiff className="h-4 w-4 text-[#d8ff5e]"/><h2 className="font-mono text-xs uppercase tracking-wider">Review evidence</h2></div><div className="mt-3 space-y-2">{reviewEvidence?.available && <><p className="text-xs text-muted-foreground whitespace-pre-wrap">{reviewEvidence.diff || 'No uncommitted diff.'}</p>{reviewEvidence.status.map((x: string) => <p key={x} className="font-mono text-xs">{x}</p>)}</>}{sessions.filter((x: any) => x.status !== 'streaming').slice(-3).reverse().map((x: any) => <div key={x.chatId} className="border-b border-[#29332f] pb-2 text-sm"><b>{agentLabel(x.cli)}</b><span className="ml-2 text-muted-foreground">{x.status}</span><p className="mt-1 truncate text-xs text-muted-foreground">{x.prompt}</p></div>)}</div></section></div>
  </div>;
}
