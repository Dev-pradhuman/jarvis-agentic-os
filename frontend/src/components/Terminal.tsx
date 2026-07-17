import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';
import { useJarvisStore } from '../store';

export function CommandTerminal({ cli = '', folder = '' }: { cli?: string; folder?: string }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const setTerminalConnected = useJarvisStore((s) => s.setTerminalConnected);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: 'transparent',
        foreground: '#e5e7eb',
        cursor: '#a855f7',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(168, 85, 247, 0.3)',
      },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    let socket: any = null;
    let initialized = false;

    const initTerminal = () => {
      if (initialized) return;
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        initialized = true;
        try { fitAddon.fit(); } catch(e) {}

        socket = io('http://localhost:3030');

        socket.on('connect', () => {
          setTerminalConnected(true);
          socket.emit('terminal_start', { cli, folder, cols: term.cols, rows: term.rows });
        });

        socket.on('disconnect', () => {
          setTerminalConnected(false);
        });

        socket.on('terminal_data', (data: string) => {
          term.write(data);
        });

        socket.on('terminal_exit', () => {
          term.write('\r\n[Process exited]\r\n');
        });

        term.onData((data: string) => {
          if (socket) socket.emit('terminal_input', data);
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      try {
        if (!initialized) {
          initTerminal();
        } else {
          fitAddon.fit();
          if (socket && socket.connected) {
            socket.emit('terminal_resize', { cols: term.cols, rows: term.rows });
          }
        }
      } catch (e) {}
    });
    
    resizeObserver.observe(terminalRef.current);
    setTimeout(initTerminal, 300);

    return () => {
      resizeObserver.disconnect();
      if (socket) socket.disconnect();
      term.dispose();
      setTerminalConnected(false);
    };
  }, [cli, folder, setTerminalConnected]);

  return (
    <div className="glass-panel overflow-hidden relative flex flex-col h-full w-full">
      <div className="h-8 border-b border-white/[0.05] flex items-center px-4 bg-black/20 shrink-0">
        <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
          Native Terminal {cli ? `[${cli}]` : ''}
        </span>
      </div>
      <div className="flex-1 overflow-hidden relative p-2">
        <div className="w-full h-full xterm-wrapper" ref={terminalRef}></div>
      </div>
      <style>{`
        .xterm-wrapper .xterm-viewport {
          background-color: transparent !important;
        }
        .xterm-wrapper .xterm-screen {
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
