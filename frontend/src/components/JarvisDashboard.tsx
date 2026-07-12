import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  Activity,
  BrainCircuit,
  Calendar,
  FileText,
  Inbox,
  Mail,
  Mic,
  NotebookPen,
  Radio,
  Search,
  Sparkles,
  Sun,
  Target,
  Terminal,
  X,
  Zap,
} from "lucide-react";

import { useJarvisStore } from "../store";
import { sendSkill } from "../hooks/useSocket";
import { useVoice } from "../hooks/useVoice";

// ─────────────────────────────────────────────────────────────
// Types + mock data
// ─────────────────────────────────────────────────────────────

type Vital = { label: string; value: string; pct: number; tone: "accent" | "success" };
type Directive = { id: string; title: string; tag: string };
type DocItem = { id: string; name: string; when: string };
type LogLine = { id: string; time: string; source: string; text: string; tone: "muted" | "accent" | "success" };
type Skill = {
  id: string;
  label: string;
  sub: string;
  icon: typeof Sparkles;
  steps: string[];
};
type CalEvent = { id: string; time: string; title: string; where: string; live?: boolean };

const VITALS: Vital[] = [
  { label: "CONTEXT", value: "466K", pct: 72, tone: "accent" },
  { label: "MEMORY", value: "128K", pct: 44, tone: "accent" },
  { label: "AGENTS", value: "07", pct: 88, tone: "success" },
  { label: "LATENCY", value: "042ms", pct: 21, tone: "success" },
];

const DIRECTIVES: Directive[] = [
  { id: "d1", title: "Ship Q3 retrospective deck", tag: "P0" },
  { id: "d2", title: "Review 12 pending PRs across repos", tag: "P1" },
  { id: "d3", title: "Draft strategy memo — Northwind acq.", tag: "P1" },
];

const DOCS: DocItem[] = [
  { id: "f1", name: "strategy-memo-v3.md", when: "2m" },
  { id: "f2", name: "board-notes-oct.pdf", when: "14m" },
  { id: "f3", name: "runbook-agent-fleet.md", when: "1h" },
  { id: "f4", name: "northwind-diligence.xlsx", when: "3h" },
  { id: "f5", name: "roadmap-2026.canvas", when: "yday" },
  { id: "f6", name: "meeting-transcript.txt", when: "yday" },
];

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
    sub: "Triage 47 threads",
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
  {
    id: "focus",
    label: "Focus Mode",
    sub: "Silence non-critical",
    icon: Target,
    steps: ["Muting channels", "Rerouting agents", "Entering deep work"],
  },
];

// Maps a Skill Matrix button to its orchestrator SKILL_ id. Skills without a
// backend id (e.g. focus) run as a pure client-side visual.
const SKILL_BACKEND_ID: Record<string, string | undefined> = {
  morning: "SKILL_MORNING_BRIEF",
  inbox: "SKILL_INBOX_TRIAGE",
  deep: "SKILL_DEEP_RESEARCH",
  sched: "SKILL_SCHEDULE_CHECK",
  note: "SKILL_CREATE_NOTE",
  focus: undefined,
};

const CALENDAR: CalEvent[] = [
  { id: "e1", time: "09:00", title: "Standup — Fleet team", where: "Meet" },
  { id: "e2", time: "10:30", title: "1:1 with Priya", where: "Room 3", live: true },
  { id: "e3", time: "12:00", title: "Lunch — Marcus", where: "Onsite" },
  { id: "e4", time: "14:00", title: "Northwind diligence review", where: "Zoom" },
  { id: "e5", time: "16:30", title: "Deep work — memo", where: "Blocked" },
  { id: "e6", time: "18:00", title: "Board dinner", where: "SoHo" },
];

const LOG_SEEDS: Omit<LogLine, "id" | "time">[] = [
  { source: "core", text: "context.ingest → 12 sources synced", tone: "muted" },
  { source: "agent-04", text: "spawned researcher, budget=8k tokens", tone: "accent" },
  { source: "vault", text: "indexed strategy-memo-v3.md (14kb)", tone: "muted" },
  { source: "core", text: "voice.listener online — passive mode", tone: "success" },
  { source: "agent-02", text: "reply drafted for thread #inbox/2841", tone: "accent" },
  { source: "sys", text: "gc.pass reclaimed 42MB", tone: "muted" },
  { source: "core", text: "priority queue rebalanced (3 items)", tone: "muted" },
  { source: "agent-07", text: "calendar conflict resolved: 14:00", tone: "success" },
  { source: "sys", text: "heartbeat 042ms — nominal", tone: "muted" },
  { source: "core", text: "user.intent = focus_mode (confidence 0.91)", tone: "accent" },
];

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

const MOCK_TOKENS = [8, 14, 11, 22, 19, 31, 28, 40, 46, 44, 55, 62, 58, 71, 68, 74, 80, 77, 88, 92];

function TokenSparkline() {
  const live = useJarvisStore((s) => s.liveState);
  const raw = live?.tokens?.length ? live.tokens : MOCK_TOKENS;
  const label = live?.tokensLabel ?? "92k";

  const points = useMemo(() => {
    const max = Math.max(...raw, 1);
    return raw.map((v, i) => ({ x: (i / (raw.length - 1)) * 100, y: 100 - (v / max) * 90 }));
  }, [raw]);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = `${line} L 100 100 L 0 100 Z`;

  return (
    <div className="relative h-[70px] w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="tok-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#tok-fill)" />
        <path d={line} fill="none" stroke="#a78bfa" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute right-0 top-0 font-mono text-[10px] text-muted-foreground">
        <span className="text-white/90">{label}</span> total
      </div>
      <div className="absolute left-0 bottom-0 font-mono text-[10px] text-muted-foreground">session →</div>
    </div>
  );
}

function LeftPanel() {
  const live = useJarvisStore((s) => s.liveState);
  const vitals = live?.vitals?.length ? live.vitals : VITALS;
  const directives = live?.directives?.length ? live.directives : DIRECTIVES;
  const docs = live?.documents?.length ? live.documents : DOCS;
  const tokensLabel = live?.tokensLabel ?? "92K/hr";

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

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Mock idle feed — runs only while no live orchestrator logs exist. */
function MockFeed() {
  const [lines, setLines] = useState<LogLine[]>([]);
  useEffect(() => {
    const now = new Date();
    const seed = LOG_SEEDS.slice(0, 6).map((s, i) => ({
      ...s,
      id: `seed-${i}`,
      time: fmtTime(new Date(now.getTime() - (6 - i) * 4000)),
    }));
    setLines(seed);

    let i = 0;
    const t = setInterval(() => {
      const src = LOG_SEEDS[i % LOG_SEEDS.length];
      setLines((prev) => [...prev.slice(-14), { ...src, id: `${Date.now()}-${i}`, time: fmtTime(new Date()) }]);
      i += 1;
    }, 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <AnimatePresence initial={false}>
      {lines.map((l) => (
        <motion.div
          key={l.id}
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: "spring", damping: 22, stiffness: 260 }}
          className="font-mono text-[12px] leading-[1.6] flex gap-3"
        >
          <span className="text-muted-foreground/60 tabular-nums">{l.time}</span>
          <span
            className="tabular-nums"
            style={{ color: l.tone === "accent" ? "#a78bfa" : l.tone === "success" ? "#10b981" : "#87878a" }}
          >
            [{l.source}]
          </span>
          <span className="text-white/70">{l.text}</span>
        </motion.div>
      ))}
    </AnimatePresence>
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
    <div className="glass-panel h-[180px] flex flex-col overflow-hidden">
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
          <span className="font-mono text-[10px] text-muted-foreground">{connected ? "streaming" : "offline · demo"}</span>
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
        ) : (
          <MockFeed />
        )}
      </div>
    </div>
  );
}

type RunningSkill = { skill: Skill; step: number; progress: number; label?: string };

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
    <section className="relative flex flex-col gap-4 min-h-0 h-full">
      {/* Top status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusPill label="CORE" active />
          <StatusPill label="LISTENING" active={isListening} />
          <StatusPill label="ONLINE" active={connected} />
        </div>
        <button
          onClick={toggle}
          className="glass-panel flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors hover:bg-white/[0.04]"
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

      {/* Core stage */}
      <div className="relative flex-1 glass-panel overflow-hidden">
        {/* Radial gradient backdrop */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at center, rgba(139,92,246,0.10), transparent 60%)" }}
        />
        {/* Scanline */}
        <div
          className="absolute inset-x-0 h-24 pointer-events-none opacity-30"
          style={{
            background: "linear-gradient(to bottom, transparent, rgba(139,92,246,0.15), transparent)",
            animation: "scan 6s linear infinite",
          }}
        />

        {/* Soft radial glow behind the core */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            width: "min(55vh, 620px)",
            height: "min(55vh, 620px)",
            background:
              "radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(139,92,246,0.12) 35%, rgba(139,92,246,0) 70%)",
            filter: "blur(20px)",
          }}
        />

        {/* 3D Core canvas — fills the stage between status bar and terminal feed */}
        <div className="absolute inset-0 z-[1] flex items-center justify-center">
          <div style={{ width: "100%", height: "100%" }}>
            <CoreCanvas />
          </div>
        </div>

        {/* Prompt line */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center z-10">
          <div className="font-mono text-[10px] tracking-[0.35em] text-muted-foreground uppercase">The Core</div>
          <div className="mt-1 font-sans text-[14px] font-medium" style={{ color: "#c4b5fd" }}>
            standing by · ask anything
          </div>
        </div>

        {/* Corner ticks */}
        {["top-4 left-4", "top-4 right-4", "bottom-4 left-4", "bottom-4 right-4"].map((pos, i) => (
          <div key={i} className={`absolute ${pos} font-mono text-[9px] text-muted-foreground/50 z-10`}>
            {["N", "E", "S", "W"][i]}·{["0x00", "0x1f", "0x2e", "0x4a"][i]}
          </div>
        ))}

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
                  <div className="grid place-items-center h-9 w-9 rounded-lg" style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.35)" }}>
                    <running.skill.icon className="h-4 w-4" style={{ color: "#c4b5fd" }} />
                  </div>
                  <div>
                    <div className="font-sans text-[13px] font-medium text-white">{running.skill.label}</div>
                    <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">automation · running</div>
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
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: "#a78bfa" }}>
                    {Math.round(running.progress)}%
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "#8b5cf6", boxShadow: "0 0 12px rgba(139,92,246,0.7)" }}
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

      <TerminalFeed />
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
        <div className="font-mono font-semibold text-[38px] leading-none text-white tabular-nums tracking-tight">
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
  return (
    <div className="grid grid-cols-2 gap-2">
      {SKILLS.map((s) => (
        <motion.button
          key={s.id}
          onClick={() => onRun(s)}
          whileHover={{
            scale: 1.02,
            backgroundColor: "rgba(139,92,246,0.06)",
            borderColor: "rgba(139,92,246,0.35)",
          }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", damping: 20, stiffness: 400 }}
          className="group relative text-left p-3 rounded-xl border overflow-hidden"
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
  const events = live?.calendar?.length ? live.calendar : CALENDAR;
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
        <div className="font-mono text-[10px] text-muted-foreground">op·1</div>
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
      {/* Ambient glows */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[520px] w-[520px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(139,92,246,0.10), transparent 70%)" }}
      />
      <div
        className="absolute bottom-0 right-0 h-[300px] w-[300px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,0.06), transparent 70%)" }}
      />
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
    liveSeen.current = false;
    setRunning({ skill: s, step: 0, progress: 0 });
    const beId = SKILL_BACKEND_ID[s.id];
    if (beId) sendSkill(beId);
  }

  // Mock progress fallback. For a skill with a live backend, cap at 92% until the
  // real COMPLETED/FAILED event lands; pure client-side skills animate to 100%.
  useEffect(() => {
    if (!running) return;
    const beId = SKILL_BACKEND_ID[running.skill.id];
    const backendDriven = !!beId && connected;
    const total = running.skill.steps.length;
    const t = setInterval(() => {
      setRunning((prev) => {
        if (!prev) return prev;
        if (liveSeen.current) return prev; // real data now drives it
        const cap = backendDriven ? 92 : 100;
        const next = Math.min(cap, prev.progress + 2 + Math.random() * 3);
        const step = Math.min(total - 1, Math.floor((next / 100) * total));
        return { ...prev, progress: next, step };
      });
    }, 220);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.skill.id, connected]);

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
      setRunning((prev) =>
        prev ? { ...prev, progress: 100, step: total - 1, label: live.currentActionLog } : prev,
      );
      const id = setTimeout(() => setRunning(null), 1800);
      return () => clearTimeout(id);
    }
    // RUNNING: adopt the real action-log label; let mock animate the bar toward the cap.
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
