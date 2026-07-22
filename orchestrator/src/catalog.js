/**
 * Curated "best of" catalog — high-signal MCP servers and skills that most projects
 * benefit from. `seedBest(folder)` imports them into the brain (MCPs sync to every
 * CLI + bridge into APIs; skills land in the Skills dashboard). Idempotent: re-adding
 * an item overwrites it, never duplicates.
 */

import { addMcp } from './mcp.js';
import { saveSkill } from './skillsManager.js';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';

// Widely-used, well-maintained MCP servers. filesystem is scoped to the projects root.
export const BEST_MCPS = [
  { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', PROJECTS_ROOT], desc: 'Read/write local files under the projects root' },
  { name: 'git', command: 'uvx', args: ['mcp-server-git'], desc: 'Git status/diff/log/commit on the working repo' },
  { name: 'fetch', command: 'uvx', args: ['mcp-server-fetch'], desc: 'Fetch and read web pages as markdown' },
  { name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], desc: 'Persistent knowledge-graph memory across sessions' },
  { name: 'sequential-thinking', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], desc: 'Structured step-by-step reasoning tool' },
  { name: 'context7', command: 'npx', args: ['-y', '@upstash/context7-mcp'], desc: 'Up-to-date library/framework documentation' },
  { name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp'], desc: 'Drive a real browser (navigate, click, scrape)' },
];

// Popular remote integration MCP servers, wired through `mcp-remote` (stdio) so they
// work across EVERY CLI (incl. codex) + the API bridge, and handle OAuth via the
// browser on first connect (token cached in ~/.mcp-auth). Added disabled — run the
// one-time auth (`npx -y mcp-remote <url>`) then enable them. `authUrl` is that URL.
function remote(url) { return { command: 'npx', args: ['-y', 'mcp-remote', url], authUrl: url, needsAuth: true }; }
export const INTEGRATION_MCPS = [
  // Composio retired the rube.app host (its DNS zone now publishes no A record),
  // so the old URL fails with ENOTFOUND. connect.composio.dev is the live endpoint.
  { name: 'composio-rube', ...remote('https://connect.composio.dev/mcp'), desc: 'Composio Rube — 500+ app integrations (Gmail, Slack, GitHub, Notion…)' },
  { name: 'cloudflare-observability', ...remote('https://observability.mcp.cloudflare.com/sse'), desc: 'Cloudflare Workers logs, errors, analytics' },
  { name: 'datadog', ...remote('https://mcp.datadoghq.com/api/unstable/mcp-server/mcp'), desc: 'Datadog metrics, logs, monitors, traces' },
  { name: 'sentry', ...remote('https://mcp.sentry.dev/mcp'), desc: 'Sentry issues, errors, releases (official)' },
];

// Token-lean SOP skills. IDs use the SKILL_ prefix so labels render cleanly.
export const BEST_SKILLS = [
  {
    id: 'SKILL_CODE_REVIEW',
    content: `# Code Review\n\nReview the target diff or file for correctness bugs first, then reuse/simplification.\n\n1. Identify the changed surface and what it's meant to do.\n2. Find correctness issues: edge cases, off-by-one, null/undefined, races, wrong async.\n3. Note reuse/simplification/efficiency wins — only concrete, high-confidence ones.\n4. Output: most-severe first, each as \`file:line — one-line defect + failing scenario\`.\nBe terse. No praise, no restating the code.`,
  },
  {
    id: 'SKILL_SUMMARIZE',
    content: `# Summarize\n\nProduce a tight, faithful summary of the provided material.\n\n1. Extract the thesis and the load-bearing facts only.\n2. Drop filler, examples, and repetition.\n3. Output 3–7 bullets, most important first; preserve numbers and names exactly.\nNever add claims not in the source.`,
  },
  {
    id: 'SKILL_PLAN',
    content: `# Plan\n\nTurn a goal into the smallest correct implementation plan.\n\n1. State the goal in one line and list hard constraints.\n2. Identify the critical files/functions to touch.\n3. Give ordered steps; call out risks and the one riskiest assumption.\n4. Keep it minimal — no gold-plating. Output as a numbered list.`,
  },
  {
    id: 'SKILL_EXPLAIN_CODE',
    content: `# Explain Code\n\nExplain what a piece of code does for someone reading it cold.\n\n1. One-sentence purpose.\n2. Inputs → outputs and the key control flow.\n3. Any non-obvious behavior, side effects, or gotchas.\nBe concise; use short bullets and reference symbols by name.`,
  },
];

// Design-quality + external-tool skills requested by the user.
export const DESIGN_SKILLS = [
  {
    id: 'SKILL_IMPECCABLE',
    content: `# Impeccable — pixel-perfect polish pass\n\nRaise any UI to shipped-by-a-top-studio quality. Run as a final pass.\n\n**Checklist (fix every miss):**\n1. Spacing on an 8px grid; consistent padding/margins; no cramped or floating elements.\n2. Type scale: ≤3 sizes, clear hierarchy, 1.4–1.6 line-height, no orphan headings.\n3. Alignment: everything on a shared grid; optical centering for icons/text.\n4. Color: sufficient contrast (WCAG AA), one accent, restrained neutrals; light + dark parity.\n5. States: hover/focus/active/disabled/loading/empty/error all designed, not default.\n6. Motion: 150–250ms ease, purposeful, respects prefers-reduced-motion.\n7. Responsive: no horizontal scroll; tap targets ≥44px; content reflows cleanly.\n8. Detail: aligned corner radii, consistent border weights, crisp shadows, no z-fighting.\nOutput: a punch-list of concrete fixes, most-visible first. No vague advice.`,
  },
  {
    id: 'SKILL_HASHU_DESIGN',
    content: [
      '# Hashu Design — the Jarvis signature design language',
      '',
      'Apply the real Jarvis-OS visual system (from frontend/src/index.css + shared.tsx).',
      '',
      '## Core feel',
      'Dark, terminal-inspired command center. Calm, high-contrast, dense but breathable.',
      'Glass panels over a near-black void. Nothing decorative that is not functional.',
      '',
      '## Color tokens (literal)',
      '- Background #050507 (never pure black / gray-on-gray). Foreground near-white; muted #87878a.',
      '- Panels: rgba(255,255,255,0.02) fill, rgba(255,255,255,0.08) 1px border.',
      '- Accent violet #8b5cf6. Success #10b981. Danger #f87171.',
      '- One accent per surface: claude #8b5cf6, opencode #10b981, gemini #3b82f6,',
      '  codex #f59e0b, antigravity #ec4899, API #22d3ee, MCP #f472b6, ruflow #f59e0b.',
      '',
      '## Surfaces',
      'glass-panel = bg rgba(255,255,255,0.02) + 1px rgba(255,255,255,0.08) border +',
      'backdrop-filter blur(24px) saturate(140%) + radius 1rem (16px; 8-10px on controls) +',
      'shadow 0 20px 60px -20px rgba(0,0,0,0.8). Active glow 0 0 20px rgba(139,92,246,0.15).',
      '',
      '## Typography',
      '- Labels/meta/code: JetBrains Mono, 9-12px, UPPERCASE, letter-spacing ~0.2em, white/80-90.',
      '- Content: Inter 400-600, tight scale (<=3 sizes). Chrome is mono+tracked; content is Inter.',
      '',
      '## Components + motion',
      '- Buttons/chips rounded-md, mono 10-11px, accent border ~55% + accent fill ~14%; inactive white/8%.',
      '- Inputs bg-white/[0.03], border-white/[0.08], focus:border-white/20. Status dots pulse.',
      '- Motion 150-200ms ease, subtle scale/opacity; slow scan line for working states; respect reduced-motion.',
      '',
      '## Rules',
      '1. One accent per surface. 2. Chrome mono+uppercase, content Inter. 3. Translucent+blur, not opaque cards.',
      '4. 8px spacing rhythm, 16-20px panel padding. 5. Every control has hover/focus/active/disabled in-accent.',
      '',
      'Map each element to a token; flag and fix anything off-signature.',
    ].join('\n'),
  },
  {
    id: 'SKILL_UIUX_PRO_MAX',
    content: `# UI/UX Pro Max — world-class product design\n\nDesign or critique a UI at senior-product-designer level. Structure the work:\n\n1. **Job to be done** — who, primary task, success in one sentence.\n2. **Flow** — shortest path to done; remove steps, defaults over decisions.\n3. **Information architecture** — group by user mental model; progressive disclosure.\n4. **Layout** — visual hierarchy guides the eye to the primary action; strong grid.\n5. **Components** — reuse a system; every interactive element has all its states.\n6. **Content** — concrete microcopy, helpful empty/error states, no lorem ipsum.\n7. **Accessibility** — keyboard path, focus order, contrast, labels, reduced-motion.\n8. **Feedback** — optimistic UI, clear loading/success/failure, undo where risky.\nDeliver: the design (or a prioritized critique) + the single highest-impact change.`,
  },
  {
    id: 'SKILL_TASTE',
    content: `# Taste — design judgment\n\nJudge whether a design is tasteful and say why, concretely.\n\n**Principles:**\n- Restraint: remove until it breaks, then add back one thing. Less, but better.\n- Hierarchy: one clear focal point; everything else recedes.\n- Consistency: repeated patterns, one type scale, one spacing system, one accent.\n- Intentionality: every element earns its place; no decoration-as-filler.\n- Coherence: it feels like one hand made it; light + dark both considered.\n\nRate 1–5 on each principle with a one-line reason, then give the top 3 fixes that would most raise the taste level.`,
  },
  {
    id: 'SKILL_GSTACK',
    content: `# gstack — virtual engineering team (garrytan/gstack)\n\nA Claude Code skill pack (122k★, MIT) that turns an agent into specialized roles\n(CEO, designer, eng manager, QA, security, release) via 23 slash commands, with a\nThink→Plan→Build→Review→Test→Ship→Reflect sprint workflow.\n\n**Install (run in a terminal — use the CLI "Cmd" button):**\n\`\`\`\ngit clone https://github.com/garrytan/gstack && cd gstack && ./setup.sh\n\`\`\`\nThen use its slash commands in Claude Code. Repo: https://github.com/garrytan/gstack`,
  },
  {
    id: 'SKILL_GRAPHIFY',
    content: `# Graphify — codebase knowledge graph (Graphify-Labs/graphify)\n\nA tool (86.4k★, MIT, YC S26) that turns a repo, docs, PDFs, images, and video into an\ninteractive knowledge graph you can traverse instead of grepping. Ask "what connects\nauth to the database?" and trace real relationships.\n\n**Use:** in an AI coding assistant run \`/graphify .\` on the project root; it emits an\ninteractive HTML graph, a markdown report, and a JSON graph. Standalone CLI + MCP\nserver also available. Repo: https://github.com/Graphify-Labs/graphify`,
  },
];

/** Seed the whole catalog into the brain for `folder` (''=global). Returns counts. */
export function seedBest(folder = '') {
  let mcps = 0;
  for (const m of BEST_MCPS) {
    try { addMcp({ name: m.name, command: m.command, args: m.args, enabled: true }, folder); mcps++; } catch { /* skip */ }
  }
  let skills = 0;
  for (const s of BEST_SKILLS) {
    try { saveSkill(s.id, s.content, folder); skills++; } catch { /* skip */ }
  }
  return { mcps, skills };
}

/**
 * Seed the integration MCPs + design/tool skills. Integration MCPs are added
 * DISABLED (they need auth) so they don't sync/fail until you enable them. Returns
 * counts.
 */
export function seedExtras(folder = '') {
  let mcps = 0;
  for (const m of INTEGRATION_MCPS) {
    try {
      addMcp({ name: m.name, command: m.command, args: m.args, url: m.url, transport: m.transport, enabled: false }, folder);
      mcps++;
    } catch { /* skip */ }
  }
  let skills = 0;
  for (const s of DESIGN_SKILLS) {
    try { saveSkill(s.id, s.content, folder); skills++; } catch { /* skip */ }
  }
  return { mcps, skills };
}

/** The catalog as data (for a "browse & pick" UI later). */
export function getCatalog() {
  return {
    mcps: BEST_MCPS,
    integrations: INTEGRATION_MCPS,
    skills: [...BEST_SKILLS, ...DESIGN_SKILLS].map((s) => ({ id: s.id, preview: s.content.slice(0, 120) })),
  };
}
