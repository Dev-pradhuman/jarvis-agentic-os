/**
 * The Brain — one shared memory for every CLI, rooted at the projects folder, and
 * exposed as a live **Obsidian vault** you can open and browse.
 *
 *   C:\Users\Pradhuman\projects\.jarvis-brain\      ← open THIS folder in Obsidian
 *     .obsidian\                                     ← vault config (graph, backlinks)
 *     BRAIN.md                                       ← MAIN brain / Map of Content
 *     chats.jsonl                                    ← global chat log (machine recall)
 *     folders\<slug>\BRAIN.md                        ← SUB-brain note for one project
 *     folders\<slug>\chats.jsonl                     ← that folder's chat log
 *
 * Notes are Obsidian-native: YAML frontmatter, wiki-links via unique aliases
 * (main ⇄ sub-brains form a hub-and-spoke graph), and a live "Recent conversations"
 * block that is rewritten on EVERY chat — so with the vault open in Obsidian the
 * notes update in real time. Everything you hand-write in the "## Notes" section is
 * preserved: Jarvis only ever rewrites the fenced `jarvis:auto` block.
 *
 * Machine recall still uses the JSONL logs (fast, exact); the markdown is the human
 * + Obsidian face of the same data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { mcpCatalog } from './mcp.js';
import { SKILLS } from './skills.js';
import { getEnabledSkillInstructions, listSkills } from './skillsManager.js';
import { listPlugins } from './plugins.js';
import { isRuflowEnabled, getRuflowInjection, recordToMemoryBank } from './ruflow.js';
import { analyzeProject } from './projectAnalyzer.js';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const BRAIN_ROOT = path.join(PROJECTS_ROOT, '.jarvis-brain');
const FOLDERS_DIR = path.join(BRAIN_ROOT, 'folders');
const MAIN_BRAIN = path.join(BRAIN_ROOT, 'BRAIN.md');
const GLOBAL_LOG = path.join(BRAIN_ROOT, 'chats.jsonl');
const OBSIDIAN_DIR = path.join(BRAIN_ROOT, '.obsidian');
const FOLDER_RECALL = 20; // compact exchanges recalled from the active folder
const GLOBAL_RECALL = 12; // compact exchanges recalled across ALL projects
const NOTE_CONVERSATIONS = 15; // how many exchanges to render into a note

export const ROOT = PROJECTS_ROOT;
export const VAULT_PATH = BRAIN_ROOT;

const MAIN_ALIAS = 'Jarvis Main Brain';
const AUTO_START = '<!-- jarvis:auto:start -->';
const AUTO_END = '<!-- jarvis:auto:end -->';
// The auto-analysis block is a SEPARATE managed region from the recent-conversations
// block, with its own markers. It survives readDurable (which only strips jarvis:auto),
// so the project brief reaches every CLI as context — that's what removes the need to
// ever say "analyze this folder".
const ANALYSIS_START = '<!-- jarvis:analysis:start -->';
const ANALYSIS_END = '<!-- jarvis:analysis:end -->';

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const AUTO_RE = new RegExp(`${esc(AUTO_START)}[\\s\\S]*?${esc(AUTO_END)}`);
const ANALYSIS_RE = new RegExp(`${esc(ANALYSIS_START)}[\\s\\S]*?${esc(ANALYSIS_END)}`);

function slug(folder) {
  return (folder || '_root').replace(/[^a-zA-Z0-9._-]/g, '_');
}
function folderDir(folder) {
  return path.join(FOLDERS_DIR, slug(folder));
}
function subBrainPath(folder) {
  return path.join(folderDir(folder), 'BRAIN.md');
}
function folderLog(folder) {
  return path.join(folderDir(folder), 'chats.jsonl');
}
function subAlias(folder) {
  return `${folder || '(root)'} Brain`;
}

function readSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function oneLine(s, n) {
  return truncate(s, n);
}
function fmtTime(ts) {
  try {
    return new Date(ts || Date.now()).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return '';
  }
}

/** Read a JSONL chat log into an array (newest last). */
function readLog(p, limit) {
  try {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    const slice = limit ? lines.slice(-limit) : lines;
    return slice
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Recall = only exchanges worth remembering. A failed or stopped run teaches the
 * next agent nothing and actively misleads it: a 402 from a provider or a CLI's
 * own usage text is not a fact about the project, but it reads as one once it's
 * sitting under "Recent in this project". Filtering happens BEFORE the slice so a
 * burst of failures can't crowd the real exchanges out of the window.
 */
function readRecall(p, limit) {
  const good = readLog(p).filter((e) => e && e.status !== 'error' && e.status !== 'stopped');
  return limit ? good.slice(-limit) : good;
}

// ── Obsidian note plumbing ───────────────────────────────────────────────────

/** Remove YAML frontmatter from a note body. */
function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '');
}
/** Remove the auto-generated block so only durable, hand-written content remains. */
function stripAuto(text) {
  return text.replace(new RegExp(AUTO_RE.source, 'g'), '').replace(/\n{3,}/g, '\n\n').trim();
}
/** Durable memory only (no frontmatter, no auto block) — what CLIs get as context. */
function readDurable(p) {
  return stripFrontmatter(stripAuto(readSafe(p))).trim();
}

/** Add frontmatter to an existing note that has none (migration for old scaffolds). */
function ensureFrontmatter(filePath, fmLines) {
  let text = readSafe(filePath);
  if (text.startsWith('---')) return; // already has frontmatter
  const fm = `---\n${fmLines.join('\n')}\n---\n\n`;
  fs.writeFileSync(filePath, fm + text);
}

/** Ensure a sub-brain note body links back to the main brain (graph edge + nav). */
function ensureSubBacklink(filePath) {
  let text = readSafe(filePath);
  if (!text || text.includes(MAIN_ALIAS)) return; // already links home
  // Insert a backlink line right after the first H1 heading.
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  const backlink = `Part of [[${MAIN_ALIAS}]].`;
  if (h1 >= 0) lines.splice(h1 + 1, 0, '', backlink);
  else lines.unshift(backlink, '');
  fs.writeFileSync(filePath, lines.join('\n'));
}

/**
 * Write `autoBody` into the note's fenced auto block, leaving everything else
 * (frontmatter + hand-written notes) untouched. Creates the note from `scaffold`
 * if it doesn't exist yet.
 */
function upsertAuto(filePath, scaffold, autoBody) {
  const block = `${AUTO_START}\n${autoBody}\n${AUTO_END}`;
  let text = readSafe(filePath);
  if (!text.trim()) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${scaffold}\n\n${block}\n`);
    return;
  }
  if (AUTO_RE.test(text)) {
    text = text.replace(AUTO_RE, block);
  } else {
    text = `${text.trim()}\n\n${block}\n`;
  }
  fs.writeFileSync(filePath, text);
}

/** Render a run of exchanges as readable, linked Obsidian markdown. */
function renderConversations(entries) {
  if (!entries.length) return '_No conversations yet._';
  return entries
    .slice(-NOTE_CONVERSATIONS)
    .reverse()
    .map((e) => {
      const agent = e.cli?.startsWith('api:') ? e.cli.slice(4) : e.cli || 'agent';
      const meta = [e.model ? `\`${e.model}\`` : '', e.effort ? `· ${e.effort}` : '']
        .filter(Boolean)
        .join(' ');
      const status = e.status && e.status !== 'success' ? ` · ⚠️ ${e.status}` : '';
      return (
        `### ${fmtTime(e.ts)} · #${agent} ${meta}${status}\n` +
        `> **Ask:** ${oneLine(e.prompt, 300)}\n\n` +
        `${truncate(e.response, 700)}`
      );
    })
    .join('\n\n---\n\n');
}

// ── Vault + note scaffolds ───────────────────────────────────────────────────

/** Make `.jarvis-brain` a real Obsidian vault (idempotent). */
function ensureObsidianVault() {
  if (fs.existsSync(OBSIDIAN_DIR)) return;
  fs.mkdirSync(OBSIDIAN_DIR, { recursive: true });
  const write = (name, obj) =>
    fs.writeFileSync(path.join(OBSIDIAN_DIR, name), JSON.stringify(obj, null, 2));
  // Minimal config so Obsidian opens the folder as a vault with a useful default set
  // of core plugins (graph, backlinks, tags) and refreshes links as files change.
  write('app.json', { alwaysUpdateLinks: true, attachmentFolderPath: '_attachments' });
  write('appearance.json', { accentColor: '', theme: 'obsidian' });
  write('core-plugins.json', {
    'file-explorer': true,
    graph: true,
    backlink: true,
    'outgoing-link': true,
    'tag-pane': true,
    'page-preview': true,
    search: true,
    'global-search': true,
    'switcher': true,
    'command-palette': true,
    'daily-notes': false,
  });
}

function mainScaffold() {
  return [
    '---',
    `aliases: ["${MAIN_ALIAS}"]`,
    'type: main-brain',
    'tags: [jarvis, brain]',
    '---',
    '# 🧠 Jarvis Main Brain',
    '',
    `Shared, cross-CLI memory for everything under \`${PROJECTS_ROOT}\`. Every CLI (Claude`,
    ' Code, OpenCode, Gemini, Codex, Antigravity) and API provider reads this before each',
    ' task. This is the hub — each project links out to its own sub-brain.',
    '',
    '## Notes',
    '_Durable, hand-written memory. Add conventions, preferences, and facts here — Jarvis',
    ' never overwrites this section._',
  ].join('\n');
}

function subScaffold(folder) {
  return [
    '---',
    `aliases: ["${subAlias(folder)}"]`,
    'type: sub-brain',
    `project: "${folder || '(root)'}"`,
    'tags: [jarvis, brain]',
    '---',
    `# 🧠 ${folder || '(root)'} — Sub-Brain`,
    '',
    `Part of [[${MAIN_ALIAS}]]. Project-specific memory, shared by every CLI working in`,
    ` \`${path.join(PROJECTS_ROOT, folder || '')}\`.`,
    '',
    '## Notes',
    '_Durable, hand-written memory for this project. Jarvis never overwrites this section._',
  ].join('\n');
}

/** (Re)write the MAIN brain note: a Map of Content linking every sub-brain live. */
function renderMainNote() {
  ensureObsidianVault();
  fs.mkdirSync(FOLDERS_DIR, { recursive: true });
  ensureFrontmatter(MAIN_BRAIN, [`aliases: ["${MAIN_ALIAS}"]`, 'type: main-brain', 'tags: [jarvis, brain]']);

  const folders = listFolders();
  const rows = folders.map((f) => {
    const entries = readLog(folderLog(f));
    const last = entries[entries.length - 1];
    const when = last ? fmtTime(last.ts) : '—';
    return `- [[${subAlias(f)}|${f}]] — ${entries.length} chat${entries.length === 1 ? '' : 's'} · last active ${when}`;
  });

  const global = readLog(GLOBAL_LOG);
  const recent = global
    .slice(-GLOBAL_RECALL)
    .reverse()
    .map((e) => {
      const agent = e.cli?.startsWith('api:') ? e.cli.slice(4) : e.cli;
      const where = e.folder ? `[[${subAlias(e.folder)}|${e.folder}]]` : 'main';
      return `- ${fmtTime(e.ts)} · #${agent} in ${where} — ${oneLine(e.prompt, 120)}`;
    });

  const auto = [
    `_Updated ${fmtTime(Date.now())} · ${folders.length} projects · ${global.length} total conversations._`,
    '',
    '## Projects',
    rows.length ? rows.join('\n') : '_No project sub-brains yet._',
    '',
    '## Recent across all projects',
    recent.length ? recent.join('\n') : '_No conversations yet._',
  ].join('\n');

  upsertAuto(MAIN_BRAIN, mainScaffold(), auto);
}

/** (Re)write one folder's sub-brain note with its live recent conversations. */
function renderSubNote(folder) {
  fs.mkdirSync(folderDir(folder), { recursive: true });
  ensureFrontmatter(subBrainPath(folder), [
    `aliases: ["${subAlias(folder)}"]`,
    'type: sub-brain',
    `project: "${folder || '(root)'}"`,
    'tags: [jarvis, brain]',
  ]);
  ensureSubBacklink(subBrainPath(folder));

  const entries = readLog(folderLog(folder));
  const agents = [...new Set(entries.map((e) => (e.cli?.startsWith('api:') ? e.cli.slice(4) : e.cli)))].filter(Boolean);
  const auto = [
    `## Recent conversations`,
    `_Updated ${fmtTime(Date.now())} · ${entries.length} total${agents.length ? ` · agents: ${agents.map((a) => `#${a}`).join(' ')}` : ''}._`,
    '',
    renderConversations(entries),
  ].join('\n');

  upsertAuto(subBrainPath(folder), subScaffold(folder), auto);
}

/**
 * Run the local project analyzer and upsert its brief into this folder's sub-brain,
 * inside the jarvis:analysis block — inserted just before the recent-conversations
 * block, and never touching the hand-written ## Notes. Returns the brief written.
 */
function writeProjectAnalysis(folder) {
  const filePath = subBrainPath(folder);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, subScaffold(folder) + '\n');

  const brief = analyzeProject(folder);
  const block = `${ANALYSIS_START}\n${brief}\n${ANALYSIS_END}`;
  let text = readSafe(filePath);

  // Function replacers so a `$` in the brief (a cost, a dep name) is never parsed
  // as a $&/$1 replacement pattern — that class of bug caused the codex dup block.
  if (ANALYSIS_RE.test(text)) {
    text = text.replace(ANALYSIS_RE, () => block); // refresh in place
  } else if (AUTO_RE.test(text)) {
    text = text.replace(AUTO_RE, (m) => `${block}\n\n${m}`); // sit above recent-conversations
  } else {
    text = `${text.trim()}\n\n${block}\n`;
  }
  fs.writeFileSync(filePath, text);
  return brief;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Create the vault + main brain note if missing. */
export function ensureBrain() {
  fs.mkdirSync(FOLDERS_DIR, { recursive: true });
  ensureObsidianVault();
  if (!fs.existsSync(MAIN_BRAIN)) {
    fs.writeFileSync(MAIN_BRAIN, mainScaffold() + '\n');
  }
  renderMainNote();
}

function ensureSubBrain(folder) {
  fs.mkdirSync(folderDir(folder), { recursive: true });
  const p = subBrainPath(folder);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, subScaffold(folder) + '\n');
  }
  return p;
}

/**
 * Assemble the shared context injected before a CLI prompt: main brain + this
 * folder's sub-brain (durable notes only — recent chats are injected separately
 * from the logs so they aren't double-counted) + recent conversation recall.
 */
export function getContext(folder) {
  ensureBrain();
  ensureSubBrain(folder);

  // Self-populate on first use: if this folder has never been analyzed, scan it
  // once now so the very first prompt already carries the project brief. The block
  // then persists, so this bounded scan runs at most once per project — not per
  // prompt. This is what lets you skip "analyze this folder" entirely.
  if (folder && !readSafe(subBrainPath(folder)).includes(ANALYSIS_START)) {
    try { writeProjectAnalysis(folder); } catch { /* best-effort; never block a prompt */ }
  }

  const ruflowOn = isRuflowEnabled(folder);
  const compact = (e) => `- [${e.cli}${e.folder ? '/' + e.folder : ''}] ${truncate(e.prompt, 160)} → ${truncate(e.response, 220)}`;
  // Ruflow keeps context lean: the distilled memory bank stands in for the verbose
  // recent-conversation dump (fewer input tokens), while still grounding the agent.
  const folderRecent = ruflowOn ? '' : readRecall(folderLog(folder), FOLDER_RECALL).map(compact).join('\n');
  const globalRecent = ruflowOn ? '' : readRecall(GLOBAL_LOG, GLOBAL_RECALL).map(compact).join('\n');
  const mcpTools = mcpCatalog();
  // The REAL skill store (SOPs on disk incl. everything activated from Claude Code
  // plugins), not just the 5 voice-router built-ins — otherwise every skill you add
  // is invisible to the agents. Disabled skills are omitted; ruflow trims the list
  // to the router-registered ones to stay token-lean.
  const skillsCatalog = (() => {
    let list = listSkills(folder).filter((s) => s.enabled);
    if (ruflowOn) list = list.filter((s) => s.registered);
    if (!list.length) return '';
    return list.map((s) => `- ${s.id}: ${s.label}`).join('\n');
  })();
  const skillInstructions = ruflowOn ? '' : getEnabledSkillInstructions(folder);
  const plugins = listPlugins(folder).filter((p) => p.enabled).map((p) => `- ${p.label || p.id}`).join('\n');

  return [
    '===== JARVIS BRAIN (shared cross-CLI memory — use it, do not repeat verbatim) =====',
    ruflowOn ? getRuflowInjection(folder) : '',
    '# Main brain (shared across ALL projects and all CLIs)',
    readDurable(MAIN_BRAIN),
    `# Project sub-brain: ${folder || '(main)'}`,
    readDurable(subBrainPath(folder)),
    folderRecent ? `# Recent in this project (all CLIs)\n${folderRecent}` : '',
    globalRecent ? `# Recent across all projects (all CLIs)\n${globalRecent}` : '',
    mcpTools ? `# MCP servers available (tools you can use)\n${mcpTools}` : '',
    skillsCatalog ? `# Jarvis skills available (SOPs — describe to run one)\n${skillsCatalog}` : '',
    skillInstructions ? `# Enabled skill instructions\n${skillInstructions}` : '',
    plugins ? `# Enabled Jarvis plugins\n${plugins}` : '',
    '# INSTRUCTION: Always provide concise and terse responses unless explicitly asked for detail.',
    '===== END BRAIN =====',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Append a completed exchange to both logs, then refresh the Obsidian notes so the
 * vault reflects the new conversation in real time.
 */
export function appendChat(entry) {
  ensureBrain();
  ensureSubBrain(entry.folder);
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(folderLog(entry.folder), line);
  fs.appendFileSync(GLOBAL_LOG, line);
  // Ruflow: roll this exchange into the distilled memory bank (no-op when off).
  recordToMemoryBank(entry.folder, { prompt: entry.prompt, response: entry.response, cli: entry.cli, status: entry.status });
  // Live Obsidian update: rewrite this folder's note + the main index.
  try {
    renderSubNote(entry.folder);
    renderMainNote();
  } catch {
    /* never let note rendering break a chat */
  }
}

/** List chats — a single folder's, or the global log if no folder given. */
export function listChats(folder, limit = 200) {
  const p = folder ? folderLog(folder) : GLOBAL_LOG;
  return readLog(p, limit);
}

/**
 * Pin a durable note into a brain's "## Notes" section (newest first). folder '' →
 * the main brain. This is what the "Remember this" action writes; it lives in the
 * hand-written region, so it's injected into every future CLI's context.
 */
export function appendNote(folder, text) {
  const p = folder ? subBrainPath(folder) : MAIN_BRAIN;
  if (folder) ensureSubBrain(folder);
  else ensureBrain();
  const bullet = `- ${fmtTime(Date.now())} — ${String(text || '').replace(/\s+/g, ' ').trim()}`;
  let content = readSafe(p);
  const autoIdx = content.indexOf(AUTO_START);
  let durable = autoIdx >= 0 ? content.slice(0, autoIdx) : content;
  const tail = autoIdx >= 0 ? content.slice(autoIdx) : '';
  if (!/^##\s+Notes/m.test(durable)) durable = `${durable.trimEnd()}\n\n## Notes\n`;
  durable = durable.replace(/(^##\s+Notes.*$)/m, `$1\n${bullet}`);
  content = `${durable.trimEnd()}\n\n${tail}`.trimEnd() + '\n';
  fs.writeFileSync(p, content);
  return { ok: true, note: p, folder: folder || '' };
}

/** Search every chat log + durable note for a query. Returns ranked snippets. */
export function searchBrain(query, limit = 40) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const out = [];
  const around = (text, i, span = 110) => {
    const s = Math.max(0, i - Math.floor(span / 3));
    return text.slice(s, s + span).replace(/\s+/g, ' ').trim();
  };

  for (const e of readLog(GLOBAL_LOG)) {
    const composite = `${e.prompt || ''}\n${e.response || ''}`;
    const i = composite.toLowerCase().indexOf(q);
    if (i >= 0) {
      out.push({
        type: 'chat',
        chatId: e.chatId,
        folder: e.folder || '',
        agent: e.cli?.startsWith('api:') ? e.cli.slice(4) : e.cli,
        ts: e.ts,
        snippet: around(composite, i),
      });
    }
  }

  const notePaths = [['', MAIN_BRAIN], ...listFolders().map((f) => [f, subBrainPath(f)])];
  for (const [f, p] of notePaths) {
    const text = readDurable(p);
    const i = text.toLowerCase().indexOf(q);
    if (i >= 0) out.push({ type: 'note', folder: f, snippet: around(text, i) });
  }

  // Chats newest-first, notes after.
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out.slice(0, limit);
}

/** Create + render a sub-brain note for every project folder (so none is forgotten). */
export function generateAllSubBrains() {
  ensureBrain();
  const created = [];
  const all = listFolders();
  for (const f of all) {
    const p = subBrainPath(f);
    const existed = fs.existsSync(p);
    ensureSubBrain(f);
    renderSubNote(f); // refresh recent-conversations block from the log
    // A brand-new project gets analyzed the first time we ever see it — that's the
    // "new projects at the time of making them" path: the folder is understood
    // before any CLI touches it, so nobody has to say "analyze this folder".
    if (!existed) { try { writeProjectAnalysis(f); } catch { /* best-effort */ } created.push(f); }
  }
  renderMainNote();
  return { total: all.length, created };
}

/**
 * Re-run the analyzer for one folder (or every folder when `folder` is undefined)
 * and refresh the sub-brain brief. This is the manual "re-analyze" path for when a
 * project has changed shape since it was first seen.
 */
export function analyzeFolder(folder) {
  ensureBrain();
  if (folder === undefined) {
    const all = listFolders();
    for (const f of all) { ensureSubBrain(f); try { writeProjectAnalysis(f); } catch { /* skip */ } }
    return { analyzed: all.length };
  }
  ensureSubBrain(folder);
  const brief = writeProjectAnalysis(folder);
  return { folder, brief };
}

/** Subfolders of the projects root (candidate sub-brains). */
export function listFolders() {
  try {
    return fs
      .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          !e.name.startsWith('_') && // skip private/meta folders (e.g. _secrets)
          e.name !== 'node_modules',
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
