/**
 * 3-Tier Intent Routing Engine.
 *
 * Every transcript is evaluated in order, stopping at the FIRST match, to minimize
 * both latency and API cost:
 *   Tier 1  RegEx        — 0ms, deterministic exact triggers
 *   Tier 2  Role model   — semantic classification via the user-configured "router"
 *                          role: ANY installed CLI or ANY saved API provider
 *                          (set in the Roles modal). No hardcoded provider.
 *   Tier 3  Local LLM    — offline / privacy-sensitive fallback (stubbed)
 *
 * @typedef {Object} RoutingDecision
 * @property {string}  transcriptId
 * @property {'REGEX'|'ROLE'|'LOCAL'|'UNMATCHED'} matchedTier
 * @property {string|null} targetSkillId
 * @property {Record<string, any>} extractedParameters
 */

import { getRoles } from './roles.js';
import { getCli } from './cli.js';
import { runCli } from './cliRunner.js';
import { runApiChat } from './providers.js';
import { ROOT } from './brain.js';
import { projectPath } from './security.js';

// ---- Tier 1: deterministic RegEx dictionary -------------------------------
const REGEX_RULES = [
  { re: /(give me the|what is the|what's the) rundown/i, skill: 'SKILL_MORNING_BRIEF' },
  { re: /(check|read)( my)? inbox/i, skill: 'SKILL_INBOX_TRIAGE' },
  { re: /(clear|close) (the )?(screen|popups?)/i, skill: 'UI_CLEAR_CONTEXT' },
];

// ---- Tier 2: role-model semantic classifier -------------------------------
const ROUTER_SYSTEM_PROMPT = `You are the routing engine for an Agentic OS.
Map the user's request to exactly ONE of the following Skill IDs.
If the request is conversational and requires no action, return 'CONVERSATION'.
If no skill matches, return 'UNKNOWN'.

Available Skills:
- SKILL_DEEP_RESEARCH: User wants to search the web or YouTube for a topic.
- SKILL_SCHEDULE_CHECK: User asks about their calendar or day.
- SKILL_CREATE_NOTE: User wants to save a thought to Obsidian.
- SKILL_MORNING_BRIEF: User wants their daily rundown / morning report.
- SKILL_INBOX_TRIAGE: User wants their email triaged.

Also, determine if the request requires writing or editing real code (frontend or backend), as opposed to conversation/research/notes.

Return ONLY a valid JSON object: { "skillId": "...", "isCodingTask": boolean, "parameters": {} }`;

/** Extract the first balanced JSON object from arbitrary model output. */
function extractJson(text) {
  let raw = (text || '').trim();
  if (raw.includes('```json')) {
    raw = raw.split('```json')[1]?.split('```')[0]?.trim() ?? raw;
  } else if (raw.includes('```')) {
    raw = raw.split('```')[1]?.split('```')[0]?.trim() ?? raw;
  }
  if (!raw.startsWith('{')) {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s !== -1 && e !== -1) raw = raw.substring(s, e + 1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @returns {RoutingDecision|null} */
function tier1(transcriptId, text) {
  for (const { re, skill } of REGEX_RULES) {
    if (re.test(text)) {
      return { transcriptId, matchedTier: 'REGEX', targetSkillId: skill, isCodingTask: false, extractedParameters: {} };
    }
  }
  return null;
}

/**
 * Tier 2 — classify via the user-configured `router` role. The role can be any
 * CLI (spawned headless, uses its own auth) or any saved API provider. If the
 * role is unavailable or the output can't be parsed, fall through to Tier 3.
 * @returns {Promise<RoutingDecision|null>}
 */
async function tier2(transcriptId, text, folder) {
  const roleCfg = getRoles(folder).router;
  if (!roleCfg) return null;

  const fullPrompt = `${ROUTER_SYSTEM_PROMPT}\n\nUser Transcript: "${text}"`;
  let outputText = '';

  try {
    if (roleCfg.kind === 'api' || roleCfg.kind === 'provider') {
      const controller = new AbortController();
      const result = await runApiChat(roleCfg.id, roleCfg.model, fullPrompt, () => {}, controller.signal);
      outputText = result?.output ?? '';
    } else {
      const cli = getCli(roleCfg.id);
      if (!cli || !cli.available) return null;
      const cwd = projectPath(ROOT, folder);
      const result = await runCli(cli, roleCfg.model, roleCfg.effort, cwd, fullPrompt);
      outputText = result?.output ?? '';
    }
  } catch (e) {
    console.error('[router] classify dispatch failed:', e.message);
    return null;
  }

  const parsed = extractJson(outputText);
  if (!parsed) return null;

  const skillId = parsed.skillId;
  const targetSkillId =
    !skillId || skillId === 'UNKNOWN' ? null : skillId === 'CONVERSATION' ? 'CONVERSATION' : skillId;

  return {
    transcriptId,
    matchedTier: 'ROLE',
    targetSkillId,
    isCodingTask: !!parsed.isCodingTask,
    extractedParameters: parsed.parameters || {},
  };
}

/** Tier 3 — local LLM fallback. Stub: wire to a local server (e.g. Ollama) later. */
async function tier3(transcriptId /*, text */) {
  return { transcriptId, matchedTier: 'UNMATCHED', targetSkillId: null, isCodingTask: false, extractedParameters: {} };
}

/**
 * Route a transcript through all three tiers.
 * @param {string} transcriptId
 * @param {string} text
 * @param {string} [folder] project folder — lets a per-project router override apply
 * @returns {Promise<RoutingDecision>}
 */
export async function route(transcriptId, text, folder = '') {
  return (
    tier1(transcriptId, text) ||
    (await tier2(transcriptId, text, folder)) ||
    (await tier3(transcriptId, text))
  );
}
