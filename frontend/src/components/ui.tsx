import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useJarvisStore } from "../store";

/* ────────────────────────────── Skeletons ──────────────────────────────
 * Shown while the socket is connecting / a list hasn't arrived yet, so the UI
 * never flashes a misleading "empty state" for data that is merely in flight.
 */

/** One shimmering placeholder bar. */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      style={{ background: "rgba(255,255,255,0.04)", ...style }}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite]"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)" }} />
    </div>
  );
}

/** Card-shaped skeleton — matches the density of a real list row. */
export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-white/[0.06] p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-10 ml-auto" />
      </div>
      <Skeleton className="h-2.5 w-3/4" />
    </div>
  );
}

/** A grid of skeleton cards. */
export function SkeletonGrid({ count = 6, minWidth = 300 }: { count?: number; minWidth?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-panel p-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-2/3" />
          <div className="flex gap-1.5 mt-1">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-5 w-14 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a list of rows inside an existing panel. */
export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

/* ─────────────────────────────── Stat tile ───────────────────────────────
 * COMMAND DECK style: icon in a tinted rounded chip, big value, small sublabel.
 */
export function StatTile({
  icon: Icon, label, value, sub, color = "#8b5cf6", loading = false,
}: { icon: any; label: string; value: React.ReactNode; sub?: string; color?: string; loading?: boolean }) {
  return (
    <div className="glass-panel px-4 py-3.5 flex flex-col gap-2 relative overflow-hidden">
      {/* subtle accent wash — the depth in the reference design */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(120% 100% at 0% 0%, ${color}14, transparent 60%)` }} />
      <div className="flex items-center gap-2 relative">
        <span className="grid place-items-center h-6 w-6 rounded-md shrink-0"
          style={{ background: `${color}1f`, border: `1px solid ${color}3d` }}>
          <Icon className="h-3.5 w-3.5" style={{ color }} />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground truncate">{label}</span>
      </div>
      <div className="relative">
        {loading
          ? <Skeleton className="h-7 w-20" />
          : <div className="font-mono text-[26px] leading-none text-white/95 tabular-nums">{value}</div>}
        {sub && <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mt-1.5">{sub}</div>}
      </div>
    </div>
  );
}

/* ──────────────────────────────── Toasts ────────────────────────────────
 * Backend error/success events used to be emitted with no listener at all, so
 * failures (role save, plugin activate, terminal open) were silently swallowed.
 * These surface them.
 */
export function ToastHost() {
  const toasts = useJarvisStore((s) => s.toasts || []);
  const dismissToast = useJarvisStore((s) => s.dismissToast);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t: any) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="glass-panel pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 max-w-[380px]"
            style={{ borderColor: t.kind === "error" ? "#f8717155" : "#10b98155" }}
          >
            {t.kind === "error"
              ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#f87171" }} />
              : <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#10b981" }} />}
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: t.kind === "error" ? "#f87171" : "#10b981" }}>
                {t.title}
              </div>
              <div className="font-mono text-[11px] text-white/80 break-words leading-snug mt-0.5">{t.message}</div>
            </div>
            <button onClick={() => dismissToast(t.id)} className="grid place-items-center h-5 w-5 rounded hover:bg-white/[0.06] shrink-0">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Small helper: a value that counts up smoothly (used by the usage tiles). */
export function useCountUp(target: number, ms = 500) {
  const [v, setV] = useState(target);
  useEffect(() => {
    const from = v;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return v;
}
