import { useEffect } from 'react';
import { Activity, Command, FolderGit2, MessagesSquare, Plug, Square, Zap } from 'lucide-react';
import { ProjectsTab } from './components/ProjectsTab';
import { ChatsTab } from './components/ChatsTab';
import { SkillsTab } from './components/SkillsTab';
import { McpsTab } from './components/McpsTab';
import { UsageTab } from './components/UsageTab';
import { CommandPalette } from './components/CommandPalette';
import { useSocket, stopAll } from './hooks/useSocket';
import { useJarvisStore } from './store';

const TABS = [
  { id: 'projects', icon: FolderGit2, label: 'Projects' },
  { id: 'chats', icon: MessagesSquare, label: 'Chats' },
  { id: 'skills', icon: Zap, label: 'Skills' },
  { id: 'mcps', icon: Plug, label: 'MCPs' },
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

  const Tab = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setView(id)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-[11px] tracking-wider uppercase transition-colors"
      style={{
        color: view === id ? '#c4b5fd' : '#87878a',
        background: view === id ? 'rgba(139,92,246,0.12)' : 'transparent',
        border: `1px solid ${view === id ? 'rgba(139,92,246,0.35)' : 'transparent'}`,
      }}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
      {id === 'chats' && panes.length > 0 && (
        <span className="font-mono text-[9px] px-1 rounded" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>{panes.length}</span>
      )}
    </button>
  );

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-white/[0.06]">
      <div className="font-mono text-[12px] tracking-[0.35em] text-white/90 pl-1">JARVIS</div>
      <div className="flex items-center gap-1.5">
        {TABS.map((t) => (
          <Tab key={t.id} {...t} />
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
          <Square className="h-3 w-3" /> Stop{running ? ` ·${running}` : ''}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {activeFolder ? `sub-brain · ${activeFolder}` : 'main brain'}
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: connected ? '#10b981' : '#eab308', boxShadow: connected ? '0 0 8px rgba(16,185,129,0.9)' : 'none' }}
        />
      </div>
    </div>
  );
}

const VIEWS = {
  projects: ProjectsTab,
  chats: ChatsTab,
  skills: SkillsTab,
  mcps: McpsTab,
  usage: UsageTab,
};

export default function App() {
  useSocket();
  const view = useJarvisStore((s) => s.view);
  const setPaletteOpen = useJarvisStore((s) => s.setPaletteOpen);
  const togglePalette = useJarvisStore((s) => s.togglePalette);
  const Current = VIEWS[view] ?? ProjectsTab;

  // Global shortcuts: ⌘/Ctrl+K opens the palette. Ask for notification permission once.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener('keydown', onKey);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePalette, setPaletteOpen]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <TabBar />
      <div className="flex-1 min-h-0">
        <Current />
      </div>
      <CommandPalette />
    </div>
  );
}
