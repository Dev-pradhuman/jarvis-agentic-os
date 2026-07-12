/**
 * Universal API providers. Any AI backend — OpenAI, OpenRouter, Groq, Anthropic,
 * Gemini, Ollama, Azure OpenAI, LM Studio, vLLM, LiteLLM, local or custom
 * enterprise APIs — is added by base URL + key and routed through a per-type
 * ADAPTER (see adapters.js). Nothing is assumed about endpoints or JSON shape.
 *
 * Providers persist to the brain root (outside the repo) so API keys never enter
 * source control and are shared across all folders/CLIs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { callTool, closeClients, connectTools } from './mcpBridge.js';
import { API_TYPES, autoDetect, DISCOVERY_UNAVAILABLE_MSG, getAdapter } from './adapters.js';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const STORE = path.join(PROJECTS_ROOT, '.jarvis-brain', 'providers.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return [];
  }
}
function save(list) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(list, null, 2));
}

function slugify(s) {
  return String(s || 'provider').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Light normalization: trim trailing slashes only (never strip typed paths like /v1beta). */
function normalizeBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

/** Drop empty entries from an endpoints/headers object. */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v != null && String(v).trim() !== '') out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

export { API_TYPES };

/** Public list — API key redacted; header VALUES redacted but keys shown. */
export function listProviders() {
  return load().map(({ apiKey, headers, ...p }) => ({
    ...p,
    hasKey: !!apiKey,
    headerKeys: Object.keys(headers || {}),
  }));
}

function findRaw(id) {
  return load().find((p) => p.id === id) || null;
}

export function removeProvider(id) {
  save(load().filter((p) => p.id !== id));
  return { removed: true };
}

/**
 * Add a provider. Detects its type + models when possible, but NEVER rejects: a
 * provider with no model discovery (404/405/500/401, or none exposed) is still
 * saved in manual mode so the user can specify a model. Returns the discovery
 * outcome so the UI can prompt for a manual model when needed.
 *
 * @param {{name?, label?, baseUrl, apiKey?, headers?, model?, providerType?, endpoints?, apiVersion?, maxTokens?}} spec
 * @returns {Promise<{provider, models, discovered, message?}>}
 */
export async function addProvider(spec) {
  const baseUrl = normalizeBase(spec.baseUrl);
  if (!baseUrl) throw new Error('Base URL is required');

  const name = spec.name || spec.label || '';
  const headers = clean(spec.headers);
  const endpoints = clean(spec.endpoints);
  let providerType = spec.providerType && spec.providerType !== 'unknown' ? spec.providerType : 'unknown';

  const detectSpec = { baseUrl, apiKey: spec.apiKey || '', headers, endpoints, providerType, apiVersion: spec.apiVersion };

  let models = [];
  let discovered = false;
  let message;

  if (providerType === 'unknown') {
    // Auto-detect: cascade through candidate types, but keep the provider either way.
    const result = await autoDetect(detectSpec);
    providerType = result.providerType;
    models = result.models || [];
    discovered = result.discovered;
    message = result.message;
  } else {
    // Explicit type — try discovery via that adapter, still save on failure.
    const adapter = getAdapter({ ...detectSpec, providerType });
    const result = await adapter.discoverModels().catch(() => ({ discovered: false, message: DISCOVERY_UNAVAILABLE_MSG }));
    models = result.models || [];
    discovered = result.discovered;
    message = result.message;
  }

  const id = slugify(name || providerType);
  const provider = {
    id,
    label: name || providerType,
    baseUrl,
    providerType,
    apiKey: spec.apiKey || '',
    headers,
    endpoints,
    model: (spec.model || '').trim(),
    apiVersion: spec.apiVersion || undefined,
    maxTokens: spec.maxTokens || undefined,
    manual: !discovered,
    type: 'api',
    createdAt: Date.now(),
  };
  const list = load().filter((p) => p.id !== id);
  list.push(provider);
  save(list);

  const { apiKey: _k, headers: _h, ...safe } = provider;
  return {
    provider: { ...safe, hasKey: !!provider.apiKey, headerKeys: Object.keys(headers) },
    models,
    discovered,
    message: discovered ? undefined : message || DISCOVERY_UNAVAILABLE_MSG,
  };
}

/** Update mutable fields of an existing provider (e.g. set a manual model, headers). */
export function updateProvider(id, patch = {}) {
  const list = load();
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider ${id}`);
  if (patch.model !== undefined) p.model = String(patch.model).trim();
  if (patch.apiKey !== undefined && patch.apiKey !== '') p.apiKey = patch.apiKey;
  if (patch.headers) p.headers = clean(patch.headers);
  if (patch.endpoints) p.endpoints = clean(patch.endpoints);
  if (patch.providerType) p.providerType = patch.providerType;
  if (patch.apiVersion !== undefined) p.apiVersion = patch.apiVersion;
  save(list);
  const { apiKey, headers, ...safe } = p;
  return { ...safe, hasKey: !!apiKey, headerKeys: Object.keys(headers || {}) };
}

/** (Re)discover a provider's models through its adapter. */
export async function modelsForProvider(id) {
  const p = findRaw(id);
  if (!p) throw new Error(`unknown provider ${id}`);
  const result = await getAdapter(p).discoverModels();
  return result.models || [];
}

/**
 * Run a chat against any provider via its adapter, streaming tokens through
 * onChunk. OpenAI-family adapters also expose enabled MCP tools and execute tool
 * calls (up to a few rounds); other types stream text directly.
 */
export async function runApiChat(providerId, model, prompt, onChunk = () => {}, signal) {
  const p = findRaw(providerId);
  if (!p) return { status: 'error', output: `unknown provider ${providerId}` };
  const adapter = getAdapter(p);
  const useModel = model || p.model;
  if (!useModel) {
    return { status: 'error', output: `[jarvis] no model set for "${p.label}". Pick or enter a model first.` };
  }

  // MCP tools only apply to OpenAI-shaped chat (tool_calls protocol).
  const supportsTools = ['openai', 'openrouter', 'groq', 'azure', 'custom'].includes(p.providerType);
  const { clients, tools, toolMap } = supportsTools ? await connectTools(onChunk) : { clients: [], tools: [], toolMap: new Map() };

  const messages = [{ role: 'user', content: prompt }];
  let output = '';
  const MAX_ROUNDS = 5;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal?.aborted) { await closeClients(clients); return { status: 'stopped', output }; }
      const r = await adapter.chat({
        model: useModel,
        messages,
        tools: supportsTools ? tools : undefined,
        onChunk: (c) => { output += c; onChunk(c); },
        signal,
      });
      if (r.aborted) { await closeClients(clients); return { status: 'stopped', output }; }
      if (r.error) {
        await closeClients(clients);
        return { status: 'error', output: `${output}\n${r.error}` };
      }
      if (!r.toolCalls || !r.toolCalls.length) break; // model answered

      messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls });
      for (const tc of r.toolCalls) {
        onChunk(`\n[mcp] → ${tc.function.name}(${tc.function.arguments})\n`);
        const result = await callTool(toolMap, tc.function.name, tc.function.arguments).catch((e) => ({ error: e.message }));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result.text || result.error || '' });
      }
    }
  } catch (e) {
    await closeClients(clients);
    return { status: 'error', output: `${output}\n[api error] ${e.message}` };
  }

  await closeClients(clients);
  return { status: 'success', output };
}

/** Embeddings passthrough (where the adapter supports it). */
export async function runEmbeddings(providerId, model, input) {
  const p = findRaw(providerId);
  if (!p) throw new Error(`unknown provider ${providerId}`);
  return getAdapter(p).embeddings({ model: model || p.model, input });
}

/** Image generation passthrough (where the adapter supports it). */
export async function runImages(providerId, model, prompt, opts = {}) {
  const p = findRaw(providerId);
  if (!p) throw new Error(`unknown provider ${providerId}`);
  return getAdapter(p).images({ model: model || p.model, prompt, ...opts });
}
