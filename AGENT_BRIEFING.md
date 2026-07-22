# Jarvis-OS — Agent Briefing

> Paste this whole document as the first message to any new agent (Claude, Aegy, etc.) that
> needs to pick up work on this project without re-discovering everything from scratch.

## What this project is

**Jarvis-OS** is a local-first, terminal-inspired "agentic operating system" dashboard — a
graphical + vocal control layer over several local AI coding CLIs (Claude Code, OpenCode, Gemini
CLI, Codex, Antigravity) and any custom API provider (OpenRouter, Groq, Anthropic, Gemini,
Ollama, Azure OpenAI, LM Studio, vLLM, etc.). Everything runs on `localhost` except outbound API
calls the user explicitly configures. Think: Iron Man's JARVIS, but real, local, and built on top
of CLIs the user already has installed.

Repo root: `C:\Users\Pradhuman\projects\Jarvis-os`

## Architecture

- **`orchestrator/`** — Node.js (Express + socket.io) backend. Spawns the CLIs as child
  processes, streams their output over WebSocket, routes voice transcripts to skills, manages a
  shared "brain" (memory), custom API providers via an adapter pattern, and MCP servers shared
  across every agent. Entry point: `orchestrator/src/index.js`. Port `3030`.
- **`frontend/`** — React 19 + Vite + Tailwind v4 + Zustand + socket.io-client SPA. 5 tabs:
  Projects, Chats, Skills, MCPs, Usage. Port `5173`.
- **`ml/`** — optional Python STT (`:8000`) / TTS (`:8001`) services for voice input/output. Not
  wired into `start.bat` yet (separate Python setup).
- **`.jarvis-brain/`** — an Obsidian vault that lives **outside the git repo**, real-time synced
  by the orchestrator. It stores every chat log, durable notes, provider API keys
  (`providers.json`), and MCP secrets. **Never commit this folder or its contents.**
- **`start.bat` / `stop.bat`** — one-click launch/stop of orchestrator + frontend (auto-installs
  deps on first run, frees ports 3030/5173 if held, opens the browser).

## Key design decisions (don't relitigate these)

- **All backend calls are meant to be isolated behind one contract** — the socket.io events in
  `frontend/src/hooks/useSocket.js` are the single source of truth for what the frontend can ask
  the backend to do. Any new UI must talk through this contract, not invent new endpoints.
- **API providers use a universal adapter pattern** (`orchestrator/src/adapters.js`) — a provider
  is *never rejected*. If model discovery fails (404/405/500/401/no endpoint), it still saves in
  "manual mode" and the user types a model name by hand. Auto-detection cascades through
  `/models → /v1/models → /api/models → /v2/models`.
- **Never assume OpenAI's shape.** Every provider type (OpenAI-compatible, Anthropic, Gemini,
  Ollama, Azure, custom) has its own adapter for building requests/parsing responses/streaming.
- **Secrets never touch git.** API keys and MCP env vars live only in `.jarvis-brain/` (outside
  the repo). `.gitignore` also excludes `.opencode/`.
- **The 5 CLIs run with dangerously-skip-permissions**, per explicit user request — this is
  intentional for this local, single-user tool.
- **MCP config sync must merge, not clobber**, the user's existing CLI configs.
- **No mock/fake data in the real app.** Everything the dashboard shows is real (live CPU/mem,
  real token counts, real chat history). The one exception is the *Lovable UI rebuild* currently
  in progress, which intentionally mocks data during design so it swaps in later (see below).

## Current state (as of this session)

1. The full 5-tab dashboard, multi-CLI split-screen chat, universal API provider system, MCP
   dashboard, Skills manager, Usage analytics, and a "productivity pack" (command palette ⌘K,
   global search, kill switch, session restore, desktop notifications, auto-retry on transient
   errors) are **built, tested, committed, and pushed** to
   `github.com/Dev-pradhuman/jarvis-agentic-os` (branch `main`, latest commit `4e20779`).
2. `start.bat` / `stop.bat` were added so the app launches with one double-click. Verified both
   services come up and respond `HTTP 200`.
3. **In progress: a frontend visual upgrade via Lovable.** I wrote a detailed rebuild prompt at
   `LOVABLE_PROMPT.md` in the repo root. It asks Lovable to rebuild the same UI with better
   visuals while keeping the exact backend contract (socket event names/payload shapes) so the
   result can be swapped back in later without a rewrite. The user is about to paste that prompt
   into Lovable, iterate on the design there, and bring the resulting frontend code back.

## What happens next (the actual task)

1. **Wait for the user to hand back a new frontend from Lovable** (zip or pasted files).
2. **Re-link it to the real backend:**
   - Drop the new `src/` into `frontend/`, preserving `frontend/src/hooks/useSocket.js` as the
     real contract (or port Lovable's `orchestrator.ts` mock functions onto it).
   - Flip Lovable's `MOCK = true` flag (or equivalent) to `false` / wire it to the real
     `socket.io-client` connection at `http://localhost:3030`.
   - Reconnect the voice mic to the STT endpoint (`:8000`) and TTS (`:8001`) if the new UI kept
     those features.
   - Confirm `vite` still serves on `5173` and every event in the contract (see
     `LOVABLE_PROMPT.md`'s "BACKEND CONTRACT" section for the full event list) round-trips
     correctly against the live orchestrator.
   - Manually click through all 5 tabs against the real backend before calling it done — start
     the app with `start.bat` and verify in-browser, not just via typecheck.
3. **Do not silently change backend event names or payload shapes** to match whatever Lovable
   generated — the contract is fixed; adapt the new UI to it, not the other way around.
4. After re-linking, run through the existing verified behaviors to confirm no regressions:
   multi-CLI chat streaming, per-tile stop + kill switch, remember-to-brain, session restore
   across reload, command palette search, provider add (both auto-discovered and manual-mode),
   MCP import/sync, Skills enable/disable/edit/run, Usage tab live numbers.
5. Only commit/push when the user explicitly asks — do not auto-commit the Lovable rebuild.

## Where to look for details

- Full backend event contract: `LOVABLE_PROMPT.md` → "BACKEND CONTRACT" section, or read
  `frontend/src/hooks/useSocket.js` directly (it's authoritative).
- Current Zustand store shape: `frontend/src/store.js`.
- Agent colors / shared modals / sidebar: `frontend/src/components/shared.tsx`.
- Orchestrator socket handlers: `orchestrator/src/index.js`.
- Universal provider adapters: `orchestrator/src/adapters.js`, `orchestrator/src/providers.js`.
- Obsidian "brain" sync logic: `orchestrator/src/brain.js`.

## Constraints to respect going forward

- API keys live in `.jarvis-brain/providers.json`, outside the repo — never commit.
- Don't kill the user's other running apps/processes when freeing ports — only target 3030/5173
  (STT/TTS 8000/8001 if those come into play).
- `_`-prefixed folders are excluded from the folder/sub-brain listing by design.
- Only commit/push when explicitly asked.
