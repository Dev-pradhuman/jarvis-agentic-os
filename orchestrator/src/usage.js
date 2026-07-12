/**
 * Usage analytics — real numbers, aggregated from the shared brain's chat log plus
 * live process telemetry. Powers the Usage dashboard tab.
 *
 *   Per-agent  : run count, tokens processed, estimated cost, total/avg exec time
 *   Live        : orchestrator CPU %, resident memory, agents in flight, event loop
 *
 * Tokens are estimated at ~4 chars/token over the prompt + response actually stored
 * in the brain. Cost is a rough estimate: local CLIs are $0 (they run on-device /
 * on the user's own subscription); API-provider calls use a small blended rate and
 * are always labelled an estimate. Exec time comes from durationMs recorded on each
 * chat entry at completion (entries written before that field existed are ignored
 * for timing but still counted for tokens).
 */

import os from 'node:os';
import { listChats } from './brain.js';

const estTokens = (chars) => Math.round((chars || 0) / 4);
// Rough blended $/1K tokens for custom API providers (est. only). Local CLIs = 0.
const API_RATE_PER_1K = 0.002;

const AGENT_LABELS = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  codex: 'Codex CLI',
  antigravity: 'Antigravity',
};

function labelFor(cli) {
  if (typeof cli === 'string' && cli.startsWith('api:')) return `API · ${cli.slice(4)}`;
  return AGENT_LABELS[cli] || cli;
}

// ── Live CPU sampling (orchestrator process) ────────────────────────────────
let lastCpu = process.cpuUsage();
let lastHrTime = Date.now();
let cpuPct = 0;
setInterval(() => {
  const now = Date.now();
  const elapsedMs = now - lastHrTime;
  const usage = process.cpuUsage(lastCpu); // micros since lastCpu
  const usedMs = (usage.user + usage.system) / 1000;
  const cores = os.cpus().length || 1;
  cpuPct = Math.min(100, Math.max(0, (usedMs / (elapsedMs * cores)) * 100));
  lastCpu = process.cpuUsage();
  lastHrTime = now;
}, 2000).unref?.();

/** Aggregate the whole brain chat log into per-agent usage rows. */
export function aggregateUsage() {
  const chats = listChats('', 100000); // whole global log
  const byAgent = new Map();
  let totalTokens = 0;
  let totalCost = 0;
  let totalRuns = 0;
  let totalDuration = 0;
  let timedRuns = 0;

  for (const c of chats) {
    const agent = c.cli || 'unknown';
    const isApi = typeof agent === 'string' && agent.startsWith('api:');
    const tokens = estTokens((c.prompt?.length || 0) + (c.response?.length || 0));
    const cost = isApi ? (tokens / 1000) * API_RATE_PER_1K : 0;
    const dur = Number(c.durationMs) || 0;

    if (!byAgent.has(agent)) {
      byAgent.set(agent, {
        id: agent,
        label: labelFor(agent),
        kind: isApi ? 'api' : 'cli',
        runs: 0,
        tokens: 0,
        cost: 0,
        durationMs: 0,
        timedRuns: 0,
        errors: 0,
        lastTs: 0,
      });
    }
    const row = byAgent.get(agent);
    row.runs += 1;
    row.tokens += tokens;
    row.cost += cost;
    if (dur > 0) {
      row.durationMs += dur;
      row.timedRuns += 1;
    }
    if (c.status && c.status !== 'success') row.errors += 1;
    if (c.ts && c.ts > row.lastTs) row.lastTs = c.ts;

    totalTokens += tokens;
    totalCost += cost;
    totalRuns += 1;
    if (dur > 0) {
      totalDuration += dur;
      timedRuns += 1;
    }
  }

  const agents = [...byAgent.values()]
    .map((r) => ({
      ...r,
      cost: Number(r.cost.toFixed(4)),
      avgDurationMs: r.timedRuns ? Math.round(r.durationMs / r.timedRuns) : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return {
    agents,
    totals: {
      runs: totalRuns,
      tokens: totalTokens,
      cost: Number(totalCost.toFixed(4)),
      avgDurationMs: timedRuns ? Math.round(totalDuration / timedRuns) : 0,
    },
  };
}

/** Live process telemetry for the Usage tab header. */
export function liveTelemetry(runningCount = 0) {
  const mem = process.memoryUsage();
  return {
    cpuPct: Number(cpuPct.toFixed(1)),
    rssMb: Math.round(mem.rss / 1048576),
    heapMb: Math.round(mem.heapUsed / 1048576),
    cores: os.cpus().length,
    totalMemMb: Math.round(os.totalmem() / 1048576),
    freeMemMb: Math.round(os.freemem() / 1048576),
    loadAvg: os.loadavg?.()[0] ?? 0,
    uptimeSec: Math.round(process.uptime()),
    agentsRunning: runningCount,
  };
}

/** Full snapshot for the Usage dashboard. */
export function getUsage(runningCount = 0) {
  return { ...aggregateUsage(), live: liveTelemetry(runningCount) };
}
