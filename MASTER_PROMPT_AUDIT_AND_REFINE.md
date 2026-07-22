# Jarvis-OS — Master Prompt: Audit What's Actually Built, Then Refine

> Paste this whole document as the task prompt to Claude Code (or any agent CLI) running in
> `C:\Users\Pradhuman\projects\Jarvis-os`. Read `AGENT_BRIEFING.md` first for architecture and
> the constraints you must not relitigate (secrets never in git, sync merges not clobbers, only
> commit/push when explicitly asked, don't touch other people's ports/processes).

## Why this prompt exists

`AGENT_BRIEFING.md` and `README.md` both make specific claims about what's done — "verified",
"tested", "round-trip verified", full checkmarked build-order lists. Claims like that rot fast:
docs get written once and never re-checked against the code. Before any new feature work (see
`MASTER_PROMPT_PROMPT_ENHANCER_AND_UNIFIED_REGISTRY.md`), **verify the current state is real**,
not aspirational. Don't trust the docs — trust what you can independently observe.

## Ground rules

- **Don't fix anything on the first pass.** First produce a complete, honest inventory. Fixing
  before you've mapped the whole surface means you patch the first bug you trip over and miss the
  pattern behind it.
- **Every claim gets a verdict**: `CONFIRMED` (you exercised it and it worked), `BROKEN` (you
  exercised it and it failed), or `UNVERIFIED` (couldn't test — say why: needs a mic permission,
  needs an API key you don't have, needs GPU, etc.). No claim gets marked confirmed from reading
  code alone — start the real services and hit them.
- **No mock success.** If a panel falls back to demo data when the socket is offline, that's not
  "live" — flag it as such per the README's own "Live data sources (no mock)" table.
- Treat this as a security/correctness read too, not just feature-completeness: check for stray
  committed secrets, overly-broad `--dangerously-skip-permissions`-style trust boundaries beyond
  what `AGENT_BRIEFING.md` already sanctions, and whether `.gitignore` actually keeps
  `.jarvis-brain/` and `.opencode/` out of git (`git status`, `git log --all -- .jarvis-brain` —
  don't just read the `.gitignore` file and assume).

## What to audit

### 1. Boot the real stack
- Run `start.bat` (or the manual per-service commands in `README.md`) and confirm orchestrator
  (`:3030`) and frontend (`:5173`) actually come up and respond `HTTP 200`, per
  `AGENT_BRIEFING.md`'s own claim. Note if `ml/` (STT `:8000` / TTS `:8001`) is even runnable on
  this machine (README says "not wired into start.bat yet — separate Python setup").
- Record actual startup errors verbatim, not paraphrased.

### 2. Walk every README "build order" checkmark
For each of the 8 checked items in `README.md`, independently verify, don't just trust the `[x]`:
1. Repo structure + manifests for all four services — do `package.json`/`requirements.txt` exist
   and actually install cleanly?
2. Python FastAPI STT/TTS — can you round-trip a real audio file through `:8000` and `:8001`, or
   is this untestable on this machine (no mic / CPU-only) — mark `UNVERIFIED` with reason if so.
3. Node orchestrator: WS hub + 3-tier router + skill wrapper + `run_skill` — connect a WS client,
   send a Tier-1 regex-matching phrase (see `orchestrator/src/router.js`'s `REGEX_RULES`), confirm
   it routes to the right skill id. Tier 2 (Haiku) needs `ANTHROPIC_API_KEY` — check if one is
   configured; if not, mark Tier 2 `UNVERIFIED`, not `CONFIRMED`.
4. Obsidian vault structure + Skill SOP files — do all 5 files listed in `skills.js`'s `SKILLS`
   registry actually exist on disk with non-empty, sensible content (not stub placeholders)?
5. React shell: grid, Zustand store, glass panels — does `frontend/src/store.js` match what
   `JarvisDashboard.tsx` actually consumes, or has drift crept in?
6. 3D audio-reactive core sphere — renders in-browser without console errors?
7. Framer Motion + Live Terminal Feed wired to real WS logs — trigger a real skill run and confirm
   the terminal feed shows real stdout, not the "mock fallback" the README admits exists.
8. End-to-end wiring (Skill Matrix → orchestrator → `claude -p` → UI, voice out via TTS, voice in
   via STT) — the README already flags voice-in as **not covered by headless automation** (needs
   manual mic permission grant). Confirm that's still true and note exactly what a human needs to
   click to complete this check themselves.

### 3. Walk `AGENT_BRIEFING.md`'s "Current state" claims
- "Full 5-tab dashboard... built, tested, committed, and pushed" to
  `github.com/Dev-pradhuman/jarvis-agentic-os` branch `main`, commit `4e20779` — confirm this
  commit exists, matches `git log`, and actually contains what's described (`git show --stat`).
  Check for drift: is the working tree still at that commit, or have untracked/uncommitted changes
  piled up since (`git status`)? List them if so.
- Click through all 5 tabs (Projects, Chats, Skills, MCPs, Usage) against the **real** running
  backend, not typecheck-only, per the briefing's own instruction. For each tab, note what's real
  vs what silently falls back to placeholder data.
- Multi-CLI chat: confirm which of the 5 CLIs (Claude Code, OpenCode, Gemini, Codex, Antigravity)
  are actually installed and invocable on this machine right now (`cli.js`'s auto-detection) vs
  which show up disabled. Antigravity is called out as "disabled until installed" — confirm that's
  still accurate.
- The Brain: confirm `.jarvis-brain/BRAIN.md`, `chats.jsonl`, and per-folder sub-brains are being
  live-updated by real usage (check `mtime` after triggering a chat) rather than stale from an
  earlier session.

### 4. Check the two in-flight items the briefing itself flags as unfinished
- `LOVABLE_PROMPT.md` — was a rebuilt frontend ever brought back and re-linked, or is this still
  pending exactly as the briefing describes ("user is about to paste that prompt into Lovable")?
  Check file timestamps and `frontend/` contents for signs a swap already happened.
- Untracked files (`AGENT_BRIEFING.md`, `LOVABLE_PROMPT.md`, `start.bat`, `stop.bat` per
  `git status`) — confirm these are intentionally uncommitted (per "only commit/push when
  explicitly asked") and not just forgotten.

### 5. Cross-check the provider/adapter claims
- `orchestrator/src/adapters.js` claims "a provider is never rejected... falls back to manual
  mode" — pick 2-3 provider types and confirm this behavior actually happens (bad/missing
  endpoint → manual mode, not a crash or silent drop).
- Confirm `.jarvis-brain/providers.json` actually holds keys outside git as claimed (it does per
  the file listing already gathered — re-confirm nothing shadows it inside the repo).

## Output format

Produce a single report, one line per checked item:

```
[CONFIRMED|BROKEN|UNVERIFIED] <area> — <what you actually did to check> — <result / reason if unverified>
```

Group by the 5 sections above. End with:
- **Drift list**: anything docs claim that code doesn't back up, or vice versa.
- **Security notes**: anything found in rule "security/correctness read" above.
- **Top N real issues worth fixing**, ranked by impact, each with the file/line if applicable.

## Then — refine (only after the report is shown to the user)

Do **not** start fixing automatically. Show the report first. Once the user picks which issues to
act on:
- Fix them one at a time, smallest safe diff, no drive-by refactors.
- Update `README.md` / `AGENT_BRIEFING.md` in the same pass if a claim there is now stale —
  docs and code should end the session in agreement.
- Re-verify each fix the same way you found the problem (re-run the service, re-click the tab,
  re-check the commit) — don't mark something fixed from reading your own diff.
- Only commit/push if the user explicitly asks, per standing project rule.
