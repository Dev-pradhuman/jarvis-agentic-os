# Jarvis-OS — Lovable Rebuild Prompt

> Paste everything between the `=== PROMPT START ===` and `=== PROMPT END ===` markers into Lovable
> as your first message. The "Files to attach" section at the bottom is for you (not Lovable).

---

## === PROMPT START ===

Build **Jarvis-OS**, a local-first "agentic operating system" dashboard — a sleek, dark,
terminal-inspired command deck that sits on top of several local AI coding CLIs and API
providers. This is a **single-page desktop web app** (not mobile-first, not a marketing site).
Think: *Iron Man's JARVIS meets a developer command center.*

I already have a working backend. **You are only rebuilding the frontend UI.** It must keep
talking to my backend over the exact same contract, so follow the integration rules below
precisely.

### Hard technical constraints (do not deviate)

1. **Stack:** Vite + React + TypeScript + Tailwind CSS. Use shadcn/ui + lucide-react icons +
   Framer Motion for animation. **Do NOT use Next.js, a router with SSR, or any server code.**
   It must run as a static SPA served by `vite`.
2. **No backend, no Supabase, no auth.** All data comes from a real-time socket connection to my
   local orchestrator. Do not add a database or login.
3. **Isolate ALL backend communication in ONE module: `src/lib/orchestrator.ts`.** This is
   critical. Every socket event and every emit goes through this file and nowhere else. The rest
   of the app imports typed functions/hooks from it. During development in Lovable, this module
   runs in **MOCK mode** (see "Mock layer" below) so the whole UI is fully interactive in preview.
   I will later flip one flag to connect it to the real `socket.io` server. Keep the event names,
   payload shapes, and function signatures EXACTLY as specified — do not rename fields.
4. **State:** use Zustand for global state (I use it today; keep it). One store in
   `src/store.ts`. Persist `{ view, activeFolder, panes, freeOnly }` to `localStorage` under key
   `jarvis:session` and restore on load.
5. Keep it **fast and keyboard-driven**. A global command palette on ⌘/Ctrl+K is required.

### Visual design (this is the part I want you to elevate)

Current look is a dark glassmorphism terminal. Keep the *soul* but make it more polished,
modern, and cohesive. Guidelines:

- **Theme:** deep near-black background (`#0b0b0f`-ish), subtle glass panels
  (`backdrop-blur`, translucent white borders `rgba(255,255,255,0.06)`), soft glows. Provide a
  reusable `.glass-panel` style.
- **Type:** monospace for labels/metadata/system text (uppercase, wide letter-spacing for section
  headers), clean sans for message/body content.
- **Motion:** tasteful — panel enter/exit, layout transitions when chat tiles are added/removed,
  a gentle pulse on "live" indicators. Never gratuitous.
- **Agent accent colors (use these EXACT hex values — they encode identity across the app):**
  - `claude` → `#8b5cf6` (violet)
  - `opencode` → `#10b981` (green)
  - `gemini` → `#3b82f6` (blue)
  - `codex` → `#f59e0b` (amber)
  - `antigravity` → `#ec4899` (pink)
  - API providers (any `api:*` id) → `#22d3ee` (cyan)
  - MCP → `#f472b6` (pink)
- A helper `agentColor(id)`: ids starting with `api:` → cyan; else look up the map above;
  default violet.
- **Signature element:** an animated 3D "core" orb on the home tab (a glowing, audio-reactive
  sphere) — reproduce with `@react-three/fiber` + `drei`, or a high-quality CSS/SVG/canvas
  fallback if 3D is heavy. It should subtly react to a `decibelLevel` (0..1) value from state.
- Make it beautiful in **dark mode only** (this app is always dark).

### App shell

- Top bar: `JARVIS` wordmark, then a 5-tab nav: **Projects · Chats · Skills · MCPs · Usage**.
  Active tab uses the violet accent. The Chats tab shows a small badge with the number of open
  chat tiles.
- Right side of top bar: a `⌘K` command-palette button, a red **Stop** kill-switch button
  (disabled when nothing is running; shows a count when agents are running), a "main brain /
  sub-brain · <folder>" status label, and a connection dot (green = connected, yellow = not).
- Global ⌘/Ctrl+K opens the command palette. Ask for desktop Notification permission once on load.

### Tab 1 — Projects (home / command deck)

- A horizontal strip of **project folders** (from state) plus a "main brain" button. Clicking a
  folder sets it active and jumps into its Chats.
- Below: the **flagship live dashboard** — the 3D core orb, a row of live "vitals" (e.g. AGENTS
  count, token usage, system stats), and a **live terminal feed** (a scrolling monospace log of
  `terminal_log` lines). Use the live `state_update` data (see contract).

### Tab 2 — Chats (the heart of the app)

- Left sidebar `BrainSidebar` (~220px): "THE BRAIN" header, the projects-root path, an "Obsidian
  vault · live" chip showing the vault path, a "Main brain" button, and a scrollable list of
  **sub-brains** (folders). Selecting one sets `activeFolder`.
- Main area:
  - An **Agent dock**: a wrapping row of pill buttons, one per CLI agent and per API provider.
    Clicking a pill **tiles that agent's chat in or out** (toggle). Unavailable CLIs are disabled
    and dimmed with an "·off" suffix. Each pill glows in its agent color when open. On the right:
    a dashed **`+ API`** button (opens "Add API Provider" modal) and a **`+ MCP`** button (opens
    the MCP import modal, with a count badge).
  - A **responsive tiled grid of chat panes** — every open agent is a live, independent chat tile,
    all usable at once. Tiling: 1 pane = full width, 2 = side by side, 3–4 = 2 columns, 5+ = 3
    columns. Animate add/remove with Framer Motion `layout`.
  - **Each chat pane** contains:
    - Header: agent name chip (in agent color); a model `<select>`; for CLI agents an effort
      `<select>` (low/medium/high); a **stop** button that appears only while that pane is
      streaming; a close (×) button.
    - Scrollable message list. Each exchange renders the user prompt, a **"remember" bookmark
      button** (pins it to the brain; turns into a green check for ~1.5s), a timestamp, and the
      streamed response in a monospace block. Auto-scroll to bottom on new content.
    - Composer: a **mic button** (voice-to-prompt — records, sends audio to the STT endpoint,
      inserts the returned transcript into the input; button pulses red while recording and its
      glow tracks mic level), a growing `<textarea>` (⌘/Ctrl+Enter submits), and a send button in
      the agent color.
  - For API providers, models come from discovery (`providerModels[providerId]`). Respect a
    global **freeOnly** toggle that filters to free models and appends "·free" to their labels.
    If a provider has no discovered models yet, request them on mount.

### Tab 3 — Skills

- Grid of **skill cards** (real SOP markdown files). Each card: file icon, label, file path,
  a 3-line preview, size in KB, relative "updated" time, a "voice-routable" tag if `registered`,
  and a live run-status chip if the skill is currently running. Actions per card: **Run** (disabled
  if the skill is disabled), **Edit**, **Delete** (with a confirm), and a **power toggle**
  (enable/disable — a disabled skill is dimmed and cannot run).
- A **"+ New skill"** button and a **Skill Editor modal**: a skill-id/filename input (locked when
  editing an existing one) and a large markdown `<textarea>` for the SOP, with a Save button.
  When editing, load the file content via the contract; when new, prefill a template.

### Tab 4 — MCPs

- Two-column layout. Left: **installed MCP servers** — each row shows name, transport badge
  (stdio/http), a "🔑 N secrets" indicator if it has env vars, and buttons: **authenticate**
  (expands an inline env-var / API-key editor with add-row + save), **power toggle**, **remove**.
  Right: an **import form** — a stdio/http mode switch, quick preset buttons (filesystem, memory,
  sequential-thinking, fetch, github), name/command/args (stdio) or url (http) inputs, and an
  "Import & sync all CLIs" button. Show `mcpError` if present.

### Tab 5 — Usage

- Top: a grid of **stat cards** — CPU %, Memory (RSS + system %), Agents live (+ uptime), Total
  runs, Tokens, Est. cost ($; "API only · local=$0"), Avg exec time. Use the `usage.live` and
  `usage.totals` data.
- A **token-throughput sparkline** (live series from `state.tokens`, a number[]), rendered as a
  row of gradient bars (violet→cyan).
- A **per-agent breakdown table**: Agent (color chip) · Runs · Tokens · Est. cost · Avg exec ·
  Errors, from `usage.agents`.

### Command palette (⌘K)

Full-screen dim overlay with a centered search box. It lists **actions** (go to each tab; a red
"Stop all agents" kill switch; "Open chat · <agent>" for each available CLI + provider; "Open
project · <folder>"; "Run skill · <skill>" for each enabled skill) filtered by the query. When the
query is ≥2 chars, also **debounce-search the brain** (200ms) via the contract and show matching
chats/notes below the actions. Arrow keys navigate, Enter runs, Esc closes. Selecting a search
result jumps to that folder's chats.

---

## BACKEND CONTRACT (implement exactly in `src/lib/orchestrator.ts`)

Transport: **socket.io client** to `http://localhost:3030` (websocket). In mock mode, simulate all
of this locally so the UI works in preview. Expose typed functions and a `useOrchestrator()` init
hook. Wire every event into the Zustand store.

### Events the server EMITS → I receive (update store on each):

- `state_update` → `{ vitals, documents, directives, calendar, tokens: number[], tokensLabel }`
- `terminal_log` → a string line (append to a capped 500-line log)
- `cli_list` → `[{ id, label, available: boolean, models: [{id,label}], efforts: string[], nativeEffort }]`
- `folders_list` → `{ root: string, vault: string, folders: string[] }`
- `provider_list` → `[{ id, label, baseUrl, providerType, manual?: boolean, model?, hasKey?: boolean }]`
- `provider_types` → `[{ id, label }]` (API types incl. "Auto Detect")
- `provider_added` → `{ provider, models: [{id,label,free}], discovered: boolean, message: string }`
- `provider_models_result` → `{ providerId, models: [{id,label,free}] }`
- `provider_error` → `{ error, providerId? }`
- `mcp_list` → `[{ id, name, label, transport: 'stdio'|'http', command, args: string[], url, enabled, env?: Record<string,string> }]`
- `mcp_added` → result object · `mcp_error` → `{ error }`
- `skills_list` → `[{ id, label, file, enabled, registered, bytes, updated, preview }]`
- `skill_content` → `{ id, content }`
- `skill_state` → `{ skillId, status: 'RUNNING'|'COMPLETED'|'FAILED', progressPercentage, currentActionLog, outputPayload? }`
- `usage_update` → `{ agents: [{ id, runs, tokens, cost, avgDurationMs, errors }], totals: { runs, tokens, cost, avgDurationMs }, live: { cpuPct, cores, rssMb, totalMemMb, freeMemMb, agentsRunning, uptimeSec } }`
- `chat_started` → `{ chatId, cliId, model, effort, folder, prompt, ts }`
- `chat_stream` → `{ chatId, cliId, chunk }` (append chunk to that session's `response`)
- `chat_done` → `{ chatId, cli, model, effort, folder, prompt, response, status: 'success'|'error'|'stopped', ts, durationMs }`
- `chats_history_result` → `{ folder, chats: ChatEntry[] }`
- `search_result` → `{ query, results: [{ type: 'chat'|'note', agent?, folder, snippet }] }`
- `remembered` → `{ ok?, error?, ... }`
- `routing_decision`, `ui_intent` → optional (log / clear popups)

### Events I EMIT → server (expose as functions):

- `chat_send` `{ cliId, model, effort, folder, prompt }` — cliId is a CLI id OR `api:<providerId>`
- `chat_stop` `{ chatId }` · `stop_all` `{}`
- `chats_history` `{ folder }`
- `remember` `{ folder, text }` · `search` `{ query }`
- `run_skill` `{ skillId, parameters }`
- `skills_request` · `skill_read {id}` · `skill_toggle {id,enabled}` · `skill_save {id,content}` · `skill_delete {id}`
- `usage_request` `{}`
- `provider_add` `{ name, baseUrl, apiKey, providerType, model?, headers?, endpoints?, apiVersion? }`
- `provider_update` `{ id, patch }` · `provider_models {providerId}` · `provider_remove {providerId}`
- `mcp_add` `{ name, command, args, env, url, transport }` · `mcp_remove {id}` · `mcp_toggle {id,enabled}`

### Voice (STT) — separate HTTP endpoints (not socket):

- Mic records audio, POSTs the blob to `http://localhost:8000` (STT), expects `{ text }` back;
  insert `text` into the composer. In mock mode, resolve a fake transcript after ~1s.
- (Optional) TTS at `http://localhost:8001` speaks skill-completion summaries.

### Mock layer (so the Lovable preview is fully alive)

In `orchestrator.ts`, gate on `const MOCK = true;`. In mock mode:
- Seed 5 CLIs (claude, opencode, gemini available; codex, antigravity unavailable), 4–6 folders,
  1–2 API providers with a handful of models (some `free`), a few MCP servers, ~5 skills, and
  believable usage numbers.
- `chat_send` should stream back a few fake chunks over ~1.5s then emit a `chat_done`.
- `search` returns a couple of fake hits. Make everything feel real. Keep all shapes identical to
  the contract so flipping `MOCK = false` swaps in the real socket with zero UI changes.

### Do NOT

- Do not rename any event or field. Do not add auth, routing, or a backend. Do not put API keys or
  secrets anywhere in the frontend. Do not change the `api:<providerId>` id convention or the agent
  color hex values.

Deliver a polished, cohesive, production-feeling dark UI that nails all five tabs, the tiled
multi-agent chat, the command palette, and the animated core. Prioritize visual quality and smooth
interaction.

## === PROMPT END ===

---

## Files to attach in Lovable (helps it match the contract & current look)

Attach these from this repo so Lovable mirrors the exact event names and current design:

1. **`frontend/src/hooks/useSocket.js`** — the authoritative list of every socket event & emit.
2. **`frontend/src/store.js`** — current Zustand shape & the `jarvis:session` persistence.
3. **`frontend/src/components/shared.tsx`** — agent colors, the two modals, the BrainSidebar.
4. **One screenshot of each tab** (Projects, Chats, Skills, MCPs, Usage) — grab them from the
   running app at http://localhost:5173 so Lovable sees the current look before upgrading it.
5. *(optional, most authoritative)* **`orchestrator/src/index.js`** — the server side of the
   contract; attach if Lovable seems unsure about payload shapes.

> Tip: In Lovable, attach the screenshots as images and paste the 4 code files as attachments/
> code blocks. Tell Lovable: *"Match these event names and field names exactly; upgrade the visuals
> freely."*

---

## When you bring the new frontend back to me

Give me the exported Lovable project (zip or git). To re-link it I will:
1. Drop your new `src/` in beside my working `useSocket.js` contract.
2. Replace Lovable's `src/lib/orchestrator.ts` mock with the real `socket.io-client` (flip
   `MOCK = false`) — or wire its functions to my existing `useSocket.js`.
3. Reconnect the STT/TTS mic endpoints (`:8000` / `:8001`).
4. Point `vite` at port 5173 and confirm every event flows against the live orchestrator.

Because all backend calls are isolated in one module with an unchanged contract, this is a swap,
not a rewrite.
