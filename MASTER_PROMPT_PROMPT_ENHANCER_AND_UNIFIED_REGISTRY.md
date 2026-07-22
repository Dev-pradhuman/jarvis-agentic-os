# Jarvis-OS — Master Prompt: Prompt Enhancer, Single Coder Model, Unified MCP/Skills/Plugins Registry

> Paste this whole document as the task prompt to Claude Code (or any agent CLI) running in
> `C:\Users\Pradhuman\projects\Jarvis-os`. It assumes the agent has already read
> `AGENT_BRIEFING.md` — read that first if you haven't; do not relitigate the decisions in it.

## Goal (3 features, in priority order)

1. **Prompt Enhancer** — every chat tile gets a shared "improve my prompt" step before send.
2. **One designated Coder model** — real code (frontend+backend) always goes through one
   consistent CLI/model, regardless of which CLI tile the user typed in.
3. **Unified registry** — MCP servers, Skills, and Plugins all live in one shared folder
   (`.jarvis-brain/`), synced/filtered per project, with a path for an agent mid-task to request
   a new one be added and enabled.

All three must respect the existing backend contract in `frontend/src/hooks/useSocket.js` and the
constraints in `AGENT_BRIEFING.md` (secrets never in git, sync merges not clobbers, only
commit/push when explicitly asked, don't touch other people's ports/processes).

---

## Feature 1 — Universal Prompt Enhancer

**Problem:** every chat tile (`ChatsTab.tsx`) has a raw `<textarea>` bound to `prompt` state
(`frontend/src/components/ChatsTab.tsx:157,275`). There's no step that improves a vague prompt
before it's spent on a real CLI run.

**Build:**

- **Backend**: one shared function, `orchestrator/src/promptEnhancer.js`, exporting
  `enhancePrompt({ raw, cliId, folder, brainContext })`. It calls a cheap/fast model (reuse the
  router's Haiku client pattern from `orchestrator/src/router.js`, not a new dependency) with a
  system prompt that:
  - Clarifies vague intent using the folder's sub-brain context (already available via
    `brain.js`) — do NOT invent requirements not implied by the raw prompt.
  - Preserves the user's original meaning; never adds scope.
  - Is explicitly optimized for **low output tokens**: the enhanced prompt should be *tighter and
    more information-dense* than the original, not longer. If the raw prompt is already clear and
    specific, return it unchanged (say so) rather than padding it.
  - Adapts phrasing to the target `cliId` if that CLI has known quirks (e.g. Codex prefers explicit
    file paths; keep this data-driven from `cli.js`, not hardcoded per-CLI prose).
  - Returns `{ enhanced: string, changed: boolean, note?: string }` — `note` is a one-line reason
    for the change, shown to the user, not appended to the prompt itself.
- **Socket contract**: add one event pair to the existing contract, documented in
  `useSocket.js` alongside the others — e.g. `enhance_prompt` (request) /
  `prompt_enhanced` (response), keyed by a request id so concurrent tiles don't cross-talk.
- **Frontend**: in `ChatsTab.tsx`, add a "✨ Enhance" button next to the send button
  (near `frontend/src/components/ChatsTab.tsx:270-279`). Clicking it:
  - Sends the current `prompt` + `agentId` (cliId) + `activeFolder` over the new event.
  - Replaces the textarea content with `enhanced` **but does not auto-send** — the user reviews
    and can edit before hitting send, same as today.
  - Shows `note` as a small inline hint (e.g. below the textarea), not a modal.
  - Disabled while a run is in flight, same guard as the existing send button
    (`!prompt.trim() || !canSend`).
- Do not add a second, separate "prompt maker" UI — this must be the *one* shared enhancer every
  chat tile calls, per your instruction ("in every chat theres a best prompt maker" — one
  implementation, not one per tile).

---

## Feature 2 — One designated Coder model for real code (front+backend)

**Problem:** right now, whichever CLI tile the user typed in is whichever CLI does the actual
coding — five different CLIs (Claude Code, OpenCode, Gemini, Codex, Antigravity) can end up
writing inconsistent, differently-styled real implementation code for the same project. You want
**one** model to be the actual coder, even though the user may be chatting across multiple tiles.

**Build:**

- **Config**: add `JARVIS_CODER_CLI` (env var, default `claude`) alongside the existing
  `JARVIS_PROJECTS_ROOT` / `JARVIS_ROUTER_MODEL` pattern in the orchestrator. Expose it as a
  setting in the UI (Usage or a small Settings affordance — reuse whatever pattern
  `ProjectsTab.tsx` or the provider settings already use; do not invent a new settings surface).
- **Classifier**: extend the existing 3-tier router (`orchestrator/src/router.js`) with a cheap
  Tier-1/Tier-2 check: "does this request require writing or editing real code (frontend or
  backend), as opposed to conversation/research/notes?" Reuse the same Haiku call already made
  for skill routing — fold the classification into the same request (one extra field in the
  returned JSON), don't add a second LLM round-trip.
- **Redirect, not silent override**: if a coding task is detected AND the user's selected CLI
  tile is *not* `JARVIS_CODER_CLI`, don't silently run it elsewhere. Surface a small inline
  prompt in `ChatsTab.tsx`: *"This looks like a code change — run it on \<coder CLI\> instead for
  consistent codebase style?"* with **Run here anyway** / **Switch & run** buttons. Respect
  whichever the user picks; remember the choice per-session so it doesn't ask every message.
- **Full-stack framing**: "real code" means both `frontend/` and `backend/`(`orchestrator/`)-style
  work in whatever project folder is active — the classifier should not try to separately detect
  frontend-vs-backend, just code-authoring-vs-not. One coder handles both, since a single
  consistent agent producing both halves of a feature is the point.
- This is a routing/UX change, not a new CLI — `cliRunner.js` and `cli.js` need no changes beyond
  reading `JARVIS_CODER_CLI`.

---

## Feature 3 — Unified MCP + Skills + Plugins registry

**Problem:** MCP servers already live centrally in `.jarvis-brain/mcp.json` and get synced out to
every CLI's native config (`orchestrator/src/mcp.js`) — that pattern is correct and should be the
template. Skills currently live **per-repo** at `vault/Jarvis_Vault/99_System/Skills/*.md`
(`orchestrator/src/skillsManager.js`), which is the opposite of what you want: you want Skills
promoted to the same shared, cross-project location as MCP, plus a new "Plugins" registry using
the identical pattern — **one folder, all three resource types, auto-filtered per project, with a
path for an agent to request new ones mid-task.**

**Build:**

- **Relocate Skills into the brain**: move the SOP files from
  `vault/Jarvis_Vault/99_System/Skills/*.md` to `.jarvis-brain/skills/*.md` (global, outside the
  repo, alongside `mcp.json`). Update `skillsManager.js`'s `SKILLS_DIR` accordingly. This is a
  breaking path change — migrate the 5 existing SOP files (`SKILL_MORNING_BRIEF.md`,
  `SKILL_INBOX_TRIAGE.md`, `SKILL_DEEP_RESEARCH.md`, `SKILL_SCHEDULE_CHECK.md`,
  `SKILL_CREATE_NOTE.md`) rather than duplicating them.
- **Per-project enable state, not global**: today `.jarvis-brain/skills-state.json` is a flat
  `{id: bool}` map (global on/off). Change it to `{ [projectFolder]: { [skillId]: bool } }` so
  each project can enable a different subset of the *same* shared skill pool — mirrors how MCP
  should also become per-project-filterable (see below). Keep a `_default` key for skills not yet
  touched in a given project.
- **New Plugins registry**: add `orchestrator/src/plugins.js`, structurally identical to
  `mcp.js` — `.jarvis-brain/plugins.json` registry + `.jarvis-brain/plugins/` folder for any
  plugin payload (scripts, configs), same `list/add/remove/setEnabled` CRUD, same per-project
  enable map as Skills above. Don't invent a different shape "for consistency's sake" — copy
  `mcp.js`'s functions and adapt naming; a plugin here just means "a third resource type synced
  the same way," it doesn't need its own sync-to-CLI-config step unless you tell me what a plugin
  actually configures.
- **Auto-filter per project**: when a project folder is opened (the "Working in …" folder switch
  already in the UI, per `AGENT_BRIEFING.md`'s All Chats section), the orchestrator should surface
  only the MCP servers / Skills / Plugins relevant to that project by default — start simple:
  "relevant" = previously enabled for that project, or globally marked `enabled: true` with no
  per-project override yet. Do not build project-content heuristics (scanning package.json /
  tech stack) in this pass — that's speculative scope; ship the explicit per-project map first.
- **Agent-requested additions**: when a coder-CLI run (Feature 2) or a skill run needs a
  capability that isn't in the registry, it should be able to signal "I need MCP/skill/plugin X."
  Simplest correct version: the orchestrator watches skill/CLI run output for a fenced block in a
  known format, e.g.
  ```
  ```jarvis:request-resource
  { "type": "mcp"|"skill"|"plugin", "name": "...", "reason": "..." }
  ```
  ```
  and on match, surfaces it in the UI (toast or a small "Suggested additions" panel in
  McpsTab.tsx / SkillsTab.tsx) for the user to approve → add-and-enable-for-this-project, or
  dismiss. **Never auto-install/auto-enable without a click** — same trust boundary as MCP import
  today.
- **UI**: `McpsTab.tsx` and `SkillsTab.tsx` currently manage their own resource type. Decide
  whether to merge them into one "Registry" tab with three sections (MCP / Skills / Plugins) or
  keep three tabs with shared components — pick whichever requires less rework of the existing
  tab shell; don't redesign the 5-tab layout for this.

---

## Cross-cutting: low-token output preference

Both the Prompt Enhancer (Feature 1) and every CLI invocation should default to **concise output**
unless the user's prompt explicitly asks for depth/detail. Concretely:

- The Prompt Enhancer's system prompt (Feature 1) must optimize for compressing the *input*
  prompt, not just leaving it verbose.
- Add one line to the brain-augmentation step in `orchestrator/src/brain.js` (wherever the
  prepended context is assembled before `cliRunner.js` sends it via stdin) instructing the CLI to
  answer tersely by default — a single standing instruction, not per-skill duplication.
- Don't build a separate "verbosity setting" UI for this pass — it's a default, overridable by
  the user just asking for more detail in their own prompt.

---

## Acceptance checklist (verify in-browser, per AGENT_BRIEFING.md's own rule — don't just typecheck)

- [ ] Type a vague prompt in any chat tile → click Enhance → textarea updates, doesn't auto-send,
      shows a one-line note, works identically across at least 2 different CLI tiles.
- [ ] A prompt like "add a delete button to the user list and wire it to the API" gets flagged as
      code-authoring and offers to switch to `JARVIS_CODER_CLI` if a different tile is active.
- [ ] `.jarvis-brain/skills/*.md` exists with the 5 migrated SOPs; old
      `vault/Jarvis_Vault/99_System/Skills/` no longer authoritative (fine to leave the old files
      or remove them — confirm which with the user before deleting).
  - [ ] Enabling a skill in Project A and disabling it in Project B actually changes execution
      eligibility per project (test by running it from both).
- [ ] `orchestrator/src/plugins.js` CRUD works via a quick script or temporary UI hook, symmetric
      with `mcp.js`.
- [ ] No secrets or `.jarvis-brain/` contents committed to git (`git status` clean of that path).
- [ ] Existing verified behaviors still work: multi-CLI chat streaming, MCP import/sync, Skills
      enable/disable/run, kill switch, session restore.

## Open questions to raise with the user before/while building (don't guess silently)

1. Should the old per-repo `vault/Jarvis_Vault/99_System/Skills/*.md` files be deleted after
   migration, or kept as a read-only fallback?
2. Does "Plugins" mean something concrete already in mind (e.g. Obsidian plugins, browser
   extensions, custom orchestrator middleware), or is it intentionally generic/empty until a real
   use case shows up? Build the registry either way, but don't invent a plugin *type system*
   speculatively.
3. Merge McpsTab/SkillsTab into one "Registry" tab, or keep separate tabs? (See Feature 3 UI note.)
