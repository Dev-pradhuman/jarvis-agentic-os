import { lazy, Suspense, useEffect } from 'react';
import { Activity, Command, FolderGit2, MessagesSquare, Plug, Square, Zap } from 'lucide-react';
import { ProjectsTab } from './components/ProjectsTab';
import { OperationsTab } from './components/OperationsTab';
import { ChatsTab } from './components/ChatsTab';
import { useSocket, stopAll } from './hooks/useSocket';
import { useJarvisStore } from './store';
import { Box, BrainCircuit, Power } from 'lucide-react';
import { ToastHost } from './components/ui';

// These are not needed for the initial dashboard render; split their sizeable
// dependency trees so opening Jarvis is faster on a cold browser cache.
const SkillsTab = lazy(() => import('./components/SkillsTab').then((m) => ({ default: m.SkillsTab })));
const McpsTab = lazy(() => import('./components/McpsTab').then((m) => ({ default: m.McpsTab })));
const PluginsTab = lazy(() => import('./components/PluginsTab').then((m) => ({ default: m.PluginsTab })));
const UsageTab = lazy(() => import('./components/UsageTab').then((m) => ({ default: m.UsageTab })));
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })));

const TABS = [
  { id: 'operations', icon: Activity, label: 'Operations' },
  { id: 'projects', icon: FolderGit2, label: 'Projects' },
  { id: 'chats', icon: MessagesSquare, label: 'Chats' },
  { id: 'skills', icon: Zap, label: 'Skills' },
  { id: 'mcps', icon: Plug, label: 'MCPs' },
  { id: 'plugins', icon: Box, label: 'Plugins' },
  { id: 'usage', icon: Activity, label: 'Usage' },
];

function TabBar() {
  const view = useJarvisStore((s) => s.view);
  const setView = useJarvisStore((s) => s.setView);
  const connected = useJarvisStore((s) => s.connected);
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const panes = useJarvisStore((s) => s.panes);
  const togglePalette = useJarvisStore((s) => s.togglePalette);
  const running = useJarvisStore((s) => s.chatSessions.filter((c) => c.status === 'streaming').length);

  const Tab = ({ id, icon: Icon, label, index }) => (
    <button
      onClick={() => setView(id)}
      className="group flex items-center gap-2 px-3 py-2 rounded-md font-mono text-[10px] tracking-wider uppercase transition-colors"
      style={{
        color: view === id ? '#101413' : '#91a19a',
        background: view === id ? '#d8ff5e' : 'transparent',
        border: '1px solid transparent',
      }}
      title={`${label} · Ctrl+${index + 1}`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
      <span className="font-mono text-[8px] text-white/25 group-hover:text-white/50 transition-colors hidden lg:inline">
        {index + 1}
      </span>
      {id === 'chats' && panes.length > 0 && (
        <span className="font-mono text-[9px] px-1 rounded" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>{panes.length}</span>
      )}
    </button>
  );

  return (
    <div className="flex items-center gap-5 px-5 py-3 border-b border-[#29332f] bg-[#101413]">
      {/* header wash — the depth from the COMMAND DECK reference */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(80% 300% at 0% 50%, rgba(139,92,246,0.10), transparent 70%)' }} />

      <div className="flex items-center gap-2 pl-1">
        <span className="grid place-items-center h-6 w-6 rounded-lg"
          style={{ background: 'linear-gradient(140deg,#8b5cf6,#6366f1)', boxShadow: '0 0 14px rgba(139,92,246,0.45)' }}>
          <BrainCircuit className="h-3.5 w-3.5 text-white" />
        </span>
        <span className="font-mono text-[12px] tracking-[0.28em] text-white/95">JARVIS.OS</span>
      </div>

      <div className="flex items-center gap-1.5">
        {TABS.map((t, i) => (
          <Tab key={t.id} {...t} index={i} />
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={togglePalette}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md font-mono text-[10px] text-muted-foreground border border-white/[0.08] hover:border-white/20 hover:text-white/80 transition-colors"
          title="Command palette"
        >
          <Command className="h-3 w-3" /> K
        </button>
        <button
          onClick={stopAll}
          disabled={running === 0}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-30"
          style={{ color: running ? '#fca5a5' : '#87878a', border: `1px solid ${running ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`, background: running ? 'rgba(239,68,68,0.1)' : 'transparent' }}
          title="Emergency stop — halt all running agents"
        >
          <Power className="h-3 w-3" /> Stop{running ? ` ·${running}` : ''}
        </button>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-1 rounded-md border border-white/[0.08]">
          {activeFolder ? `sub-brain · ${activeFolder}` : 'main brain · root'}
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{
            background: connected ? '#10b981' : '#eab308',
            boxShadow: connected ? '0 0 8px rgba(16,185,129,0.9)' : 'none',
            animation: connected ? 'pulse-dot 2.4s ease-in-out infinite' : 'none',
          }}
          title={connected ? 'Orchestrator connected' : 'Connecting…'}
        />
      </div>
    </div>
  );
}

const VIEWS = {
  operations: OperationsTab,
  projects: ProjectsTab,
  chats: ChatsTab,
  skills: SkillsTab,
  mcps: McpsTab,
  plugins: PluginsTab,
  usage: UsageTab,
};

export default function App() {
  useSocket();
  const view = useJarvisStore((s) => s.view);
  const setPaletteOpen = useJarvisStore((s) => s.setPaletteOpen);
  const togglePalette = useJarvisStore((s) => s.togglePalette);
  const Current = VIEWS[view] ?? ProjectsTab;

  const setView = useJarvisStore((s) => s.setView);

  // Global shortcuts: ⌘/Ctrl+K opens the palette, ⌘/Ctrl+1..6 jump straight to a
  // tab. Ask for notification permission once.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }
      // Digit row → tab, in the order they're rendered.
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TABS.length) {
        e.preventDefault();
        setView(TABS[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePalette, setPaletteOpen, setView]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <TabBar />
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="h-full grid place-items-center font-mono text-xs text-muted-foreground">loading module…</div>}><Current /></Suspense>
      </div>
      <Suspense fallback={null}><CommandPalette /></Suspense>
      <ToastHost />
    </div>
  );
}
