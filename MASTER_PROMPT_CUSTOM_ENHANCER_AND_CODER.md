# Jarvis-OS — Master Prompt: User-Configurable Prompt Enhancer + Coder, Kept in Sync

> Paste this whole document as the task prompt to Claude Code (or any agent CLI) running in
> `C:\Users\Pradhuman\projects\Jarvis-os`. Read `AGENT_BRIEFING.md` first. This prompt assumes
> Feature 1 (Prompt Enhancer) and Feature 2 (single Coder model) from
> `MASTER_PROMPT_PROMPT_ENHANCER_AND_UNIFIED_REGISTRY.md` already exist or are being built
> alongside this. If they don't exist yet, build the minimal version described there first — this
> prompt only covers making both of them **user-configurable** instead of hardcoded/env-only.

## What's wrong with the previous design

`MASTER_PROMPT_PROMPT_ENHANCER_AND_UNIFIED_REGISTRY.md` specified:
- The Prompt Enhancer reusing "the router's Haiku client pattern" — hardcoded to Claude Haiku.
- The Coder model picked via `JARVIS_CODER_CLI`, an env var — not a UI-editable setting.

You want both of these to be **user-chosen from a dropdown, at runtime, no env var editing or
restart required** — and whichever CLI/model you pick for one role should stay visibly in sync
with the other, since they're two roles cooperating on the same task (the enhancer rewrites the
prompt the coder is about to receive).

## Data model — one shared "Roles" config

Add a single config object, not two independent settings, so the two roles can reference each
other:

```json
// .jarvis-brain/roles.json  (global; per-project override optional, see below)
{
  "enhancer": { "kind": "cli"|"provider", "id": "claude", "model": "claude-haiku-4-5-20251001", "effort": "low" },
  "coder":    { "kind": "cli"|"provider", "id": "claude", "model": "claude-opus-4-8",            "effort": "high" }
}
```

- `kind: "cli"` → resolves against `orchestrator/src/cli.js`'s `getRegistry()`/`getCli(id)` (the
  same 5 CLIs already in the chat tile picker: Claude Code, OpenCode, Gemini, Codex, Antigravity).
- `kind: "provider"` → resolves against `orchestrator/src/providers.js`'s `listProviders()` (any
  custom API provider the user already added — OpenRouter, Groq, Ollama, etc.), routed through
  `adapters.js` instead of `cliRunner.js`. **Do not build a second model-invocation path** — reuse
  whichever function `ChatsTab.tsx` already calls for provider-backed chat tiles (check
  `useSocket.js` for the existing `send_chat`-equivalent event that already branches on
  cli-vs-provider; extend that, don't fork it).
- Both roles independently choosing `kind`/`id`/`model`/`effort` is fine and expected — "in sync"
  does **not** mean forced-identical. It means: the UI always shows both current selections
  together, changing one never silently changes or invalidates the other, and any run that uses
  both (enhance → then code) uses the exact pair the user last set, with no race where one updates
  mid-request.

Store in `.jarvis-brain/roles.json` (global default), with an optional per-project override at
`.jarvis-brain/folders/<name>/roles.json` — same override pattern already used for sub-brains in
`brain.js`. Resolution order: per-project override → global default → hardcoded fallback
(`claude` / `claude-haiku-4-5-20251001` for enhancer, `claude` / `claude-opus-4-8` for coder).

## Backend

- `orchestrator/src/roles.js` (new, small — mirrors `mcp.js`'s load/save shape):
  - `getRoles(projectFolder?)` — resolved config per the order above.
  - `setRole(role: 'enhancer'|'coder', config, projectFolder?)` — validates `id` actually exists
    in `getRegistry()` or `listProviders()` before saving (never let the UI save a dangling
    reference to an uninstalled CLI or deleted provider).
  - Broadcast a `roles_updated` socket event on any change (see below) so every open tab reflects
    the new selection immediately — this is the actual "sync" mechanism, not a polling loop.
- Update `promptEnhancer.js` (from the prior master prompt) to call `getRoles().enhancer` instead
  of a hardcoded Haiku client, and dispatch through `cliRunner.js` or `providers.js` depending on
  `kind`.
- Update the Feature-2 coder-redirect logic to read `getRoles().coder` instead of
  `process.env.JARVIS_CODER_CLI`.
- New socket events (document in `useSocket.js` alongside the rest of the contract):
  - `get_roles` → `roles_state` (current resolved config + the raw CLI/provider registries the UI
    needs to populate both dropdowns)
  - `set_role` → `roles_updated` (broadcast to all connected clients, not just the sender — this
    is what keeps multiple open tabs/windows in sync with each other)

## Frontend

- Add a small **Roles** settings panel — reuse whatever settings-surface pattern already exists
  (check `ProjectsTab.tsx` / provider-add modal in `McpsTab.tsx` for the established modal/panel
  style; don't invent new chrome). Two rows, "Prompt Enhancer" and "Coder", each with:
  - A `kind` toggle (CLI / Custom Provider).
  - A dependent dropdown populated from `getRegistry()` (if CLI) or `listProviders()` (if
    provider) — mirror exactly how the existing chat-tile CLI+model pickers in `ChatsTab.tsx`
    already do this cascading select, don't rebuild the pattern differently.
  - Effort selector, shown only if the picked CLI has `nativeEffort` or the row is CLI-kind at all
    (providers have no effort concept today — check `adapters.js` before assuming otherwise).
  - Disable/gray out any CLI marked `available: false` in the registry, same as the chat tile
    picker already does — don't let the user select an uninstalled CLI for a role.
- Show both rows together in the same panel (not two separate settings pages) — that's the
  concrete meaning of "in sync": one glance shows what's driving enhancement vs. what's driving
  real code, so the user notices immediately if e.g. the coder is still pointed at a Haiku-class
  model.
- When `roles_updated` arrives over the socket, update local state in every tab without requiring
  a page reload — this satisfies "no restart required."
- Per-project override: expose it from the same "Working in …" folder context already used for
  sub-brains — a small "override for this project" toggle in the Roles panel, off by default
  (inherits global).

## Constraints (carry over from the prior master prompt, still apply)

- Never auto-install or silently swap a CLI/provider the user didn't pick.
- Respect `AGENT_BRIEFING.md`: API keys/provider secrets stay in `.jarvis-brain/`, never in git;
  only commit/push when explicitly asked; don't invent new backend endpoints outside the
  socket-event contract in `useSocket.js`.
- Keep this additive to the existing chat-tile CLI/model picker — a chat tile's own per-message
  CLI choice is unrelated to the Enhancer/Coder roles and must keep working exactly as it does now
  for tiles not using those two features.

## Acceptance checklist (verify in-browser against the real running stack, not just typecheck)

- [ ] Open Roles panel → both Enhancer and Coder show a real resolved CLI+model (or provider),
      never blank/undefined, on first load with no prior `roles.json`.
- [ ] Change Coder to a different installed CLI → `roles_updated` fires → a second open browser
      tab reflects the change without reload.
- [ ] Set Enhancer to a custom provider (e.g. an Ollama entry already added in MCPs/Providers) →
      trigger Enhance on a chat tile → confirm the request actually goes out via `providers.js`/
      `adapters.js`, not silently falling back to the CLI path.
- [ ] Try selecting an uninstalled/unavailable CLI for either role — UI prevents it (or the
      backend rejects with a clear reason), doesn't save a broken reference.
- [ ] Set a per-project override for one project, confirm a different project still uses the
      global default.
- [ ] Restart the orchestrator process — confirm roles persist from `.jarvis-brain/roles.json`
      (not lost, not reset to hardcoded default) unless the file was never written.
- [ ] No provider API keys appear in any socket payload sent to the frontend for the Roles panel
      (reuse `listProviders()`'s existing key-redaction, don't add a new unredacted read path).

## Open question to raise with the user before building

Should switching the Coder role mid-session **interrupt an in-flight coding run** already spawned
under the old CLI, or only apply to the next run? Default to "next run only" (matches how the
existing per-tile CLI picker behaves — changing the dropdown doesn't kill a running process) unless
told otherwise.
