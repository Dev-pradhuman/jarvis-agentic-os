import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  Activity,
  BrainCircuit,
  Calendar,
  FileText,
  FolderGit2,
  Inbox,
  Mail,
  MessagesSquare,
  Mic,
  NotebookPen,
  Radio,
  Search,
  Sparkles,
  Sun,
  Terminal,
  X,
  Zap,
} from "lucide-react";

import { useJarvisStore } from "../store";
import { sendSkill } from "../hooks/useSocket";
import { useVoice } from "../hooks/useVoice";
import { Skeleton } from "./ui";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Skill = {
  id: string;
  label: string;
  sub: string;
  icon: typeof Sparkles;
  steps: string[];
};

// NOTE: the hardcoded VITALS / DIRECTIVES / DOCS / CALENDAR / LOG_SEEDS demo
// constants (and their row types) were removed. They were used as *fallbacks*, so
// an empty real list rendered invented rows — fake directives, a fake token curve,
// a synthetic log feed — indistinguishable from live data. The panels below read
// real state only, showing skeletons while the first state_update is in flight and
// honest empty states after.

const SKILLS: Skill[] = [
  {
    id: "morning",
    label: "Morning Report",
    sub: "Daily briefing",
    icon: Sun,
    steps: ["Fetching overnight signals", "Summarizing news feeds", "Ranking priorities", "Composing briefing"],
  },
  {
    id: "inbox",
    label: "Inbox Brief",
    sub: "Triage threads",
    icon: Inbox,
    steps: ["Reading inbox", "Clustering by intent", "Drafting replies", "Awaiting approval"],
  },
  {
    id: "deep",
    label: "Deep Research",
    sub: "Multi-agent probe",
    icon: Search,
    steps: ["Spawning 4 sub-agents", "Crawling sources", "Cross-referencing citations", "Synthesizing report"],
  },
  {
    id: "sched",
    label: "Schedule Check",
    sub: "Optimize calendar",
    icon: Calendar,
    steps: ["Loading calendar", "Detecting conflicts", "Proposing reshuffle"],
  },
  {
    id: "note",
    label: "Create Note",
    sub: "Capture thought",
    icon: NotebookPen,
    steps: ["Opening capture buffer", "Tagging context", "Filing to vault"],
  },
];

// Maps a Skill Matrix button to its orchestrator SKILL_ id. Every skill here MUST
// have one: a tile without a backend would animate its steps to 100% and report
// success while doing nothing. "Focus Mode" was exactly that — it claimed to mute
// channels and reroute agents with no code behind it — so it's gone until a real
// SKILL_FOCUS_MODE exists to back it.
const SKILL_BACKEND_ID: Record<string, string> = {
  morning: "SKILL_MORNING_BRIEF",
  inbox: "SKILL_INBOX_TRIAGE",
  deep: "SKILL_DEEP_RESEARCH",
  sched: "SKILL_SCHEDULE_CHECK",
  note: "SKILL_CREATE_NOTE",
};

// ─────────────────────────────────────────────────────────────
// 3D Core
// ─────────────────────────────────────────────────────────────

function CoreSphere() {
  const mesh = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  // Listening state gently boosts the breathing amplitude.
  const isListening = useJarvisStore((s) => s.isListening);
  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    const amp = isListening ? 0.12 : 0.06;
    const pulse = 1 + Math.sin(t * 1.8) * amp + Math.sin(t * 4.6) * 0.015;
    if (mesh.current) {
      mesh.current.rotation.y += delta * (isListening ? 0.5 : 0.25);
      mesh.current.rotation.x += delta * 0.06;
      mesh.current.scale.setScalar(pulse);
    }
    if (inner.current) {
      inner.current.rotation.y -= delta * 0.4;
      inner.current.rotation.z += delta * 0.1;
      inner.current.scale.setScalar(0.55 + Math.sin(t * 2.4) * 0.04);
    }
  });

  return (
    <group>
      {/* Main wireframe icosahedron */}
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1, 4]} />
        <meshPhysicalMaterial
          wireframe
          color="#8b5cf6"
          emissive="#8b5cf6"
          emissiveIntensity={1.2}
          metalness={0.8}
          roughness={0.2}
          transparent
          opacity={0.95}
        />
      </mesh>
      {/* Inner glowing core */}
      <mesh ref={inner}>
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial color="#a78bfa" wireframe transparent opacity={0.35} />
      </mesh>
      {/* Solid inner faint fill for depth */}
      <mesh scale={0.98}>
        <icosahedronGeometry args={[1, 4]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

function CoreCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.4], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <ambientLight intensity={0.4} color="#8b5cf6" />
      <pointLight position={[3, 3, 5]} intensity={2.5} color="#8b5cf6" />
      <pointLight position={[-4, -2, -3]} intensity={1.2} color="#a78bfa" />
      <CoreSphere />
    </Canvas>
  );
}

// ─────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────

function SectionHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-sans uppercase tracking-[0.18em] text-[11px] text-muted-foreground">{children}</h3>
      {right}
    </div>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="glass-panel flex items-center gap-2 px-3 py-1.5 rounded-full">
      <span
        className="relative inline-flex h-1.5 w-1.5"
        style={{ animation: active ? "pulse-dot 1.6s ease-in-out infinite" : undefined }}
      >
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: active ? "#10b981" : "#3f3f46",
            boxShadow: active ? "0 0 10px rgba(16,185,129,0.9)" : "none",
          }}
        />
      </span>
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

function GlowBar({ pct, tone }: { pct: number; tone: "accent" | "success" }) {
  const color = tone === "accent" ? "#8b5cf6" : "#10b981";
  const glow = tone === "accent" ? "rgba(139,92,246,0.6)" : "rgba(16,185,129,0.6)";
  return (
    <div className="h-[3px] w-full rounded-full bg-white/[0.04] overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", damping: 22, stiffness: 90, delay: 0.2 }}
        className="h-full rounded-full"
        style={{ background: color, boxShadow: `0 0 10px ${glow}` }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LEFT PANEL
// ─────────────────────────────────────────────────────────────

function TokenSparkline() {
  const live = useJarvisStore((s) => s.liveState);
  const raw: number[] = live?.tokens?.length ? live.tokens : []; // real series only — no invented curve
  const label = live?.tokensLabel ?? "—";

  const points = useMemo(() => {
    const max = Math.max(...raw, 1);
    // Guard the single-point case: (i / (len-1)) divides by zero and yields NaN
    // coordinates, which silently kills the path.
    const span = Math.max(1, raw.length - 1);
    return raw.map((v, i) => ({ x: (i / span) * 100, y: 100 - (v / max) * 90 }));
  }, [raw]);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = points.length > 1 ? `${line} L 100 100 L 0 100 Z` : "";

  return (
    <div className="relative h-[70px] w-full">
      {points.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center font-mono text-[10px] text-muted-foreground">
          {live ? "no token activity yet" : "…"}
        </div>
      ) : (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="tok-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <path d={area} fill="url(#tok-fill)" />}
          <path d={line} fill="none" stroke="#a78bfa" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="absolute right-0 top-0 font-mono text-[10px] text-muted-foreground">
        <span className="text-white/90">{label}</span> total
      </div>
      <div className="absolute left-0 bottom-0 font-mono text-[10px] text-muted-foreground">session →</div>
    </div>
  );
}

function LeftPanel() {
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const live = useJarvisStore((s) => s.liveState);
  
  const projectStats = useJarvisStore((s) => s.projectStats);
  const setProjectStats = useJarvisStore((s) => s.setProjectStats);

  useEffect(() => {
    if (!activeFolder) {
      setProjectStats(null);
      return;
    }
    fetch(`http://localhost:3030/project-stats?folder=${encodeURIComponent(activeFolder)}`)
      .then(r => r.json())
      .then(d => setProjectStats(d))
      .catch(e => console.error("Failed to fetch project stats", e));
  }, [activeFolder, setProjectStats]);

  const loading = !live;
  
  let vitals = live?.vitals ? [...live.vitals] : [];
  if (projectStats && vitals.length >= 2) {
    const fmtK = (n: number) => {
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return String(n);
    };
    vitals[0] = {
      label: 'TOKENS',
      value: fmtK(projectStats.estTokens),
      pct: Math.min(100, Math.max(2, (projectStats.estTokens / 50000) * 100)),
      tone: 'accent'
    };
    vitals[1] = {
      label: 'SIZE',
      value: `${Math.round(parseFloat(projectStats.sizeMb))}MB`,
      pct: Math.min(100, Math.max(2, (parseFloat(projectStats.sizeMb) / 100) * 100)),
      tone: 'accent'
    };
  }

  let directives = live?.directives ?? [];
  let docs = live?.documents ?? [];
  let calendar = live?.calendar ?? [];
  
  if (projectStats && projectStats.dashboard) {
    if (projectStats.dashboard.documents) docs = projectStats.dashboard.documents;
    if (projectStats.dashboard.directives) directives = projectStats.dashboard.directives;
    if (projectStats.dashboard.calendar) calendar = projectStats.dashboard.calendar;
  }

  const tokensLabel = live?.tokensLabel ?? "—";

  return (
    <aside className="glass-panel flex flex-col gap-5 p-5 overflow-hidden h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center h-7 w-7 rounded-md" style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)" }}>
            <BrainCircuit className="h-3.5 w-3.5" style={{ color: "#a78bfa" }} />
          </div>
          <div className="font-mono text-[11px] tracking-[0.25em] text-white/90">V.A.U.L.T.</div>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">v0.4.2</div>
      </div>

      <div>
        <SectionHeader>System Vitals</SectionHeader>
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-1 w-full" />
            </div>
          ))}
          {vitals.map((v) => (
            <div key={v.label} className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">{v.label}</span>
              </div>
              <div className="font-mono font-semibold text-[26px] leading-none text-white tabular-nums">{v.value}</div>
              <GlowBar pct={v.pct} tone={v.tone} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionHeader right={<span className="font-mono text-[10px]" style={{ color: "#a78bfa" }}>{tokensLabel}</span>}>
          Claude Tokens · 5h
        </SectionHeader>
        <TokenSparkline />
      </div>

      <div>
        <SectionHeader right={<span className="font-mono text-[10px] text-muted-foreground">{directives.length}</span>}>
          Current Directives
        </SectionHeader>
        <ul className="space-y-2">
          {loading && Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3"><Skeleton className="h-3 w-full" /></li>
          ))}
          {!loading && directives.length === 0 && (
            <li className="font-mono text-[10px] text-muted-foreground">No directives.</li>
          )}
          {directives.map((d, i) => (
            <li key={d.id} className="flex items-start gap-3">
              <span className="font-mono text-[10px] text-muted-foreground mt-1 tabular-nums">0{i + 1}</span>
              <div className="flex-1">
                <div className="text-[13px] leading-snug text-white/90">{d.title}</div>
              </div>
              <span
                className="font-mono text-[9px] tracking-[0.15em] px-1.5 py-0.5 rounded"
                style={{
                  color: d.tag === "P0" ? "#f87171" : "#a78bfa",
                  background: d.tag === "P0" ? "rgba(248,113,113,0.08)" : "rgba(139,92,246,0.08)",
                  border: `1px solid ${d.tag === "P0" ? "rgba(248,113,113,0.25)" : "rgba(139,92,246,0.25)"}`,
                }}
              >
                {d.tag}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col min-h-0 flex-1">
        <SectionHeader>Recent Documents</SectionHeader>
        <ul className="space-y-1 overflow-hidden">
          {docs.map((f) => (
            <li key={f.id}>
              <button className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/[0.03] transition-colors text-left">
                <FileText className="h-3.5 w-3.5 text-muted-foreground group-hover:text-white/80 shrink-0" />
                <span className="font-mono text-[12px] text-white/80 truncate flex-1">{f.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{f.when}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// CENTER STAGE
// ─────────────────────────────────────────────────────────────

// When the feed is idle, turn the dead space into a real launchpad: open a chat
// with any detected CLI, or jump straight into a project's sub-brain. Real data
// only (detected CLIs + folders) — no invented rows.
function IdleLaunchpad() {
  const clis = useJarvisStore((s) => s.clis);
  const folders = useJarvisStore((s) => s.folders);
  const addPane = useJarvisStore((s) => s.addPane);
  const setActiveFolder = useJarvisStore((s) => s.setActiveFolder);
  const setView = useJarvisStore((s) => s.setView);
  const available = clis.filter((c: any) => c.available);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-7 px-6">
      <div className="w-full max-w-[560px]">
        <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2.5">Quick launch</div>
        <div className="flex flex-wrap gap-2">
          {available.length === 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">No CLIs detected.</span>
          )}
          {available.map((c: any) => (
            <button
              key={c.id}
              onClick={() => addPane(c.id)}
              title={`Open a chat with ${c.label}`}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.03] transition-colors"
            >
              <MessagesSquare className="h-3.5 w-3.5" style={{ color: "#a78bfa" }} />
              <span className="font-sans text-[12px] text-white/85">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {folders.length > 0 && (
        <div className="w-full max-w-[560px]">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2.5">Jump into a project</div>
          <div className="flex flex-wrap gap-2">
            {folders.slice(0, 12).map((f: string) => (
              <button
                key={f}
                onClick={() => { setActiveFolder(f); setView("chats"); }}
                title={`Open ${f} chats`}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.03] transition-colors"
              >
                <FolderGit2 className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[11px] text-white/75">{f}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="font-mono text-[10px] text-muted-foreground/50">waiting for agent activity…</div>
    </div>
  );
}

function TerminalFeed() {
  // Real orchestrator stdout / router events, streamed via WebSocket.
  const liveLogs = useJarvisStore((s) => s.historicalLogs);
  const connected = useJarvisStore((s) => s.connected);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasLive = liveLogs.length > 0;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [liveLogs, hasLive]);

  return (
    <div className="glass-panel h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Live Feed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: connected ? "#10b981" : "#eab308",
              boxShadow: connected ? "0 0 8px rgba(16,185,129,0.9)" : "0 0 8px rgba(234,179,8,0.8)",
              animation: "pulse-dot 1.4s infinite",
            }}
          />
          <span className="font-mono text-[10px] text-muted-foreground">{connected ? "streaming" : "offline"}</span>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2" style={{ scrollbarWidth: "none" }}>
        {hasLive ? (
          <AnimatePresence initial={false}>
            {liveLogs.map((l, i) => (
              <motion.div
                key={i}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: "spring", damping: 22, stiffness: 260 }}
                className="font-mono text-[12px] leading-[1.6] text-white/70 whitespace-pre-wrap break-words"
              >
                {l}
              </motion.div>
            ))}
          </AnimatePresence>
        ) : connected ? (
          // Idle but connected: a real launchpad instead of dead space. (This used to
          // render a fabricated <MockFeed/> — invented log lines presented as real.)
          <IdleLaunchpad />
        ) : (
          <div className="h-full grid place-items-center font-mono text-[11px] text-muted-foreground">
            orchestrator offline — start it on :3030
          </div>
        )}
      </div>
    </div>
  );
}

type RunningSkill = { skill: Skill; step: number; progress: number; label?: string; failed?: boolean };

function CenterStage({
  running,
  onCancel,
}: {
  running: RunningSkill | null;
  onCancel: () => void;
}) {
  const { toggle } = useVoice();
  const isListening = useJarvisStore((s) => s.isListening);
  const connected = useJarvisStore((s) => s.connected);

  return (
    <section className="relative flex flex-col gap-3 min-h-0 h-full">
      {/* Compact core banner — a calm, audio-reactive accent (not a 50%-screen
          decoration). Identity + voice + live status in one tidy row. */}
      <div className="glass-panel relative flex items-center gap-4 px-4 py-3 shrink-0 overflow-hidden">
        <div className="h-16 w-16 shrink-0">
          <CoreCanvas />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[9px] tracking-[0.3em] text-muted-foreground uppercase">The Core</div>
          <div className="mt-0.5 font-sans text-[14px] font-medium" style={{ color: isListening ? "#6ee7b7" : "#c4b5fd" }}>
            {isListening ? "listening…" : "standing by · ask anything"}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <StatusPill label="CORE" active />
            <StatusPill label="LISTENING" active={isListening} />
            <StatusPill label="ONLINE" active={connected} />
          </div>
        </div>
        <button
          onClick={toggle}
          className="glass-panel flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors hover:bg-white/[0.04] shrink-0"
          style={isListening ? { borderColor: "rgba(16,185,129,0.5)", background: "rgba(16,185,129,0.08)" } : undefined}
          aria-label={isListening ? "Stop listening" : "Start listening"}
        >
          <Mic className="h-3 w-3" style={{ color: isListening ? "#10b981" : "#a78bfa" }} />
          <span
            className="font-mono text-[10px] tracking-[0.2em] uppercase"
            style={{ color: isListening ? "#10b981" : "#a78bfa" }}
          >
            {isListening ? "listening…" : "hey jarvis"}
          </span>
        </button>
      </div>

      {/* Live feed takes the reclaimed center — real agent activity, front and center */}
      <div className="relative flex-1 min-h-0">
        <TerminalFeed />

        {/* Running skill popup */}
        <AnimatePresence>
          {running && (
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[440px] glass-panel p-5 z-20"
              style={{ boxShadow: "0 0 40px rgba(139,92,246,0.25), 0 20px 60px -20px rgba(0,0,0,0.8)" }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="grid place-items-center h-9 w-9 rounded-lg"
                    style={{
                      background: running.failed ? "rgba(239,68,68,0.15)" : "rgba(139,92,246,0.15)",
                      border: `1px solid ${running.failed ? "rgba(239,68,68,0.4)" : "rgba(139,92,246,0.35)"}`,
                    }}>
                    <running.skill.icon className="h-4 w-4" style={{ color: running.failed ? "#fca5a5" : "#c4b5fd" }} />
                  </div>
                  <div>
                    <div className="font-sans text-[13px] font-medium text-white">{running.skill.label}</div>
                    <div className={`font-mono text-[10px] uppercase tracking-[0.2em] ${running.failed ? "" : "text-muted-foreground"}`}
                      style={running.failed ? { color: "#fca5a5" } : undefined}>
                      {running.failed ? "automation · failed" : "automation · running"}
                    </div>
                  </div>
                </div>
                <button
                  onClick={onCancel}
                  className="group grid place-items-center h-7 w-7 rounded-md hover:bg-white/[0.05] transition-colors"
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground group-hover:text-white" />
                </button>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[11px] text-white/80 truncate pr-3">
                    {running.label ?? running.skill.steps[Math.min(running.step, running.skill.steps.length - 1)]}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: running.failed ? "#fca5a5" : "#a78bfa" }}>
                    {Math.round(running.progress)}%
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: running.failed ? "#ef4444" : "#8b5cf6",
                      boxShadow: running.failed ? "0 0 12px rgba(239,68,68,0.7)" : "0 0 12px rgba(139,92,246,0.7)",
                    }}
                    animate={{ width: `${running.progress}%` }}
                    transition={{ ease: "easeOut", duration: 0.4 }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {running.skill.steps.map((_, i) => (
                    <span
                      key={i}
                      className="h-1 w-6 rounded-full"
                      style={{ background: i <= running.step ? "#8b5cf6" : "rgba(255,255,255,0.08)" }}
                    />
                  ))}
                </div>
                <button
                  onClick={onCancel}
                  className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground hover:text-white transition-colors"
                >
                  kill process
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// RIGHT PANEL
// ─────────────────────────────────────────────────────────────

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="flex items-end justify-between">
      <div>
        <div className="font-mono font-semibold text-[30px] leading-none text-white tabular-nums tracking-tight">
          {time}
        </div>
        <div className="mt-1.5 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          {date}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3" style={{ color: "#10b981" }} />
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: "#10b981" }}>synced</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">UTC-08 · PST</span>
      </div>
    </div>
  );
}

function SkillMatrix({ onRun }: { onRun: (s: Skill) => void }) {
  // Every tile dispatches to the orchestrator, so offline it can do nothing —
  // disable rather than accept a click that goes nowhere.
  const connected = useJarvisStore((s) => s.connected);
  return (
    <div className="grid grid-cols-2 gap-2">
      {SKILLS.map((s) => (
        <motion.button
          key={s.id}
          onClick={() => onRun(s)}
          disabled={!connected}
          title={connected ? `Run ${s.label}` : "Orchestrator offline — start it on :3030"}
          whileHover={connected ? {
            scale: 1.02,
            backgroundColor: "rgba(139,92,246,0.06)",
            borderColor: "rgba(139,92,246,0.35)",
          } : undefined}
          whileTap={connected ? { scale: 0.97 } : undefined}
          transition={{ type: "spring", damping: 20, stiffness: 400 }}
          className="group relative text-left p-3 rounded-xl border overflow-hidden disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-start justify-between">
            <div className="grid place-items-center h-8 w-8 rounded-lg mb-3" style={{ background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.25)" }}>
              <s.icon className="h-3.5 w-3.5" style={{ color: "#c4b5fd" }} />
            </div>
            <Zap className="h-3 w-3 text-muted-foreground/40 group-hover:text-white/60 transition-colors" />
          </div>
          <div className="font-sans text-[12px] font-medium text-white leading-tight">{s.label}</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">{s.sub}</div>
        </motion.button>
      ))}
    </div>
  );
}

function Timeline() {
  const live = useJarvisStore((s) => s.liveState);
  const projectStats = useJarvisStore((s) => s.projectStats);
  
  let events = live?.calendar ?? []; // real calendar only
  if (projectStats?.dashboard?.calendar) {
    events = projectStats.dashboard.calendar;
  }

  return (
    <div className="relative">
      <div className="absolute left-[52px] top-2 bottom-2 w-px bg-white/[0.06]" />
      <ul className="space-y-3">
        {events.map((e) => {
          const active = e.live === true;
          return (
            <li key={e.id} className="flex items-start gap-4">
              <span className="font-mono text-[11px] text-muted-foreground w-10 tabular-nums pt-0.5">{e.time}</span>
              <span
                className="relative mt-1.5 h-2 w-2 rounded-full shrink-0"
                style={{
                  background: active ? "#10b981" : "rgba(255,255,255,0.15)",
                  boxShadow: active ? "0 0 10px rgba(16,185,129,0.8)" : "none",
                }}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{ background: "#10b981", animation: "pulse-dot 1.6s infinite" }}
                  />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`font-sans text-[12.5px] leading-snug truncate ${active ? "text-white" : "text-white/75"}`}>
                  {e.title}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">{e.where}{e.live ? " · live" : ""}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RightPanel({ onRun }: { onRun: (s: Skill) => void }) {
  return (
    <aside className="glass-panel flex flex-col gap-5 p-5 overflow-hidden h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5" style={{ color: "#10b981" }} />
          <div className="font-mono text-[11px] tracking-[0.25em] text-white/90">COMMAND DECK</div>
        </div>
      </div>

      <Clock />

      <div>
        <SectionHeader right={<span className="font-mono text-[10px] text-muted-foreground">{SKILLS.length}</span>}>
          Skill Matrix
        </SectionHeader>
        <SkillMatrix onRun={onRun} />
      </div>

      <div className="flex flex-col min-h-0 flex-1">
        <SectionHeader
          right={
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
              <Mail className="h-3 w-3" /> synced
            </span>
          }
        >
          Today · Calendar
        </SectionHeader>
        <div className="overflow-hidden flex-1">
          <Timeline />
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Background grid
// ─────────────────────────────────────────────────────────────

function GridBackdrop() {
  return (
    <div className="fixed inset-0 pointer-events-none -z-10">
      <svg className="w-full h-full opacity-[0.35]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          </pattern>
          <radialGradient id="grid-fade" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="grid-mask">
            <rect width="100%" height="100%" fill="url(#grid-fade)" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" mask="url(#grid-mask)" />
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────

export function JarvisDashboard() {
  const [running, setRunning] = useState<RunningSkill | null>(null);
  const activeSkills = useJarvisStore((s) => s.activeSkills);
  const connected = useJarvisStore((s) => s.connected);
  const liveSeen = useRef(false);

  function handleRun(s: Skill) {
    if (!connected) return; // nothing would run; don't animate a lie
    liveSeen.current = false;
    setRunning({ skill: s, step: 0, progress: 0 });
    sendSkill(SKILL_BACKEND_ID[s.id]);
  }

  // Indeterminate progress: the orchestrator reports status, not a percentage, so
  // the bar creeps to show liveness. It hard-caps at 92% and only ever reaches 100%
  // when a real COMPLETED/FAILED event arrives — a bar that filled on a timer would
  // be reporting a success that hadn't happened.
  useEffect(() => {
    if (!running) return;
    const total = running.skill.steps.length;
    const t = setInterval(() => {
      setRunning((prev) => {
        if (!prev) return prev;
        if (liveSeen.current) return prev; // real data now drives it
        const next = Math.min(92, prev.progress + 2 + Math.random() * 3);
        const step = Math.min(total - 1, Math.floor((next / 100) * total));
        return { ...prev, progress: next, step };
      });
    }, 220);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.skill.id]);

  // Live override: adopt real skill_state from the orchestrator.
  useEffect(() => {
    if (!running) return;
    const beId = SKILL_BACKEND_ID[running.skill.id];
    if (!beId) return;
    const live = activeSkills.find((a) => a.skillId === beId);
    if (!live) return;

    const total = running.skill.steps.length;
    if (live.status === "COMPLETED" || live.status === "FAILED") {
      liveSeen.current = true;
      const failed = live.status === "FAILED";
      setRunning((prev) =>
        prev ? { ...prev, progress: 100, step: total - 1, label: live.currentActionLog, failed } : prev,
      );
      // Hold a failure on screen longer — it's the case worth reading.
      const id = setTimeout(() => setRunning(null), failed ? 5000 : 1800);
      return () => clearTimeout(id);
    }
    // RUNNING: adopt the real action-log label; the creep animates toward the cap.
    setRunning((prev) => (prev ? { ...prev, label: live.currentActionLog } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSkills, running?.skill.id]);

  return (
    <main className="h-full w-full p-4 overflow-hidden relative">
      <GridBackdrop />
      <div className="grid gap-4 h-full" style={{ gridTemplateColumns: "300px 1fr 1fr 320px" }}>
        <div className="col-span-1 h-full min-h-0">
          <LeftPanel />
        </div>
        <div className="col-span-2 h-full min-h-0">
          <CenterStage running={running} onCancel={() => setRunning(null)} />
        </div>
        <div className="col-span-1 h-full min-h-0">
          <RightPanel onRun={handleRun} />
        </div>
      </div>
    </main>
  );
}
