/**
 * Universal AI-provider adapters.
 *
 * Not every provider speaks the OpenAI dialect, so nothing is assumed: no
 * guaranteed `GET /models`, no guaranteed `POST /chat/completions`, no assumed
 * JSON shape. Every provider type implements the same interface and owns its own
 * request builder + response parser:
 *
 *   interface AIProviderAdapter {
 *     discoverModels()  → { discovered, models[], message? }   // never throws to reject
 *     chat({model, messages, tools, onChunk}) → { content, toolCalls[], error? }
 *     embeddings({model, input})
 *     images({model, prompt, ...})
 *     audio({model, input, ...})
 *   }
 *
 * Endpoints are resolved as: user override (provider.endpoints[kind]) → the type's
 * default → (for OpenAI/Unknown discovery) a cascade of common paths. `{model}` in
 * an endpoint is templated at call time.
 *
 * Supported types: openai, openrouter, groq, azure, anthropic, gemini, ollama,
 * custom, unknown (auto-detect). LM Studio / vLLM / LiteLLM / local servers are all
 * OpenAI-compatible and work under the `openai` (or auto-detected) type.
 */

export const MANUAL_MSG =
  'This provider does not expose model discovery. Please enter a model manually.';
export const DISCOVERY_UNAVAILABLE_MSG =
  'Automatic model discovery is unavailable. You can still use this provider by specifying a model.';

export const API_TYPES = [
  { id: 'unknown', label: 'Auto Detect' },
  { id: 'openai', label: 'OpenAI Compatible' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'groq', label: 'Groq' },
  { id: 'azure', label: 'Azure OpenAI' },
  { id: 'custom', label: 'Custom REST' },
];

// ── URL / SSE helpers ───────────────────────────────────────────────────────

export function joinUrl(base, endpoint) {
  const b = String(base || '').replace(/\/+$/, '');
  if (/^https?:\/\//i.test(endpoint)) return endpoint; // absolute override
  const e = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return b + e;
}

/** Yield raw lines from a streamed Response body (works for SSE and NDJSON). */
async function* streamLines(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      yield line;
    }
  }
  if (buf) yield buf;
}

/** Is a model free? Pricing == 0, ":free" suffix, or a known free-tier kind. */
function isFreeModel(kind, m) {
  const id = (m.id || m.name || m.model || '').toLowerCase();
  if (id.endsWith(':free')) return true;
  const p = m.pricing || {};
  const nums = ['prompt', 'completion', 'request', 'input', 'output']
    .map((k) => p[k])
    .filter((v) => v !== undefined)
    .map((v) => parseFloat(v));
  if (nums.length) return nums.every((n) => n === 0);
  return kind === 'ollama' || kind === 'local';
}

function normalizeModelRows(rows, kind) {
  return (rows || [])
    .map((m) => {
      if (typeof m === 'string') return { id: m, label: m, free: kind === 'ollama' };
      const id = m.id || m.name || m.model;
      if (!id) return null;
      const clean = String(id).replace(/^models\//, ''); // gemini prefixes with models/
      const label = m.displayName || (m.name && m.name !== id ? m.name : clean);
      return { id: clean, label, free: isFreeModel(kind, m) };
    })
    .filter(Boolean);
}

async function tryJson(url, headers) {
  try {
    const res = await fetch(url, { headers });
    const status = res.status;
    if (!res.ok) return { ok: false, status };
    const json = await res.json().catch(() => null);
    return { ok: true, status, json };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

// ── Base adapter ─────────────────────────────────────────────────────────────

export class BaseAdapter {
  static defaults = {}; // { chat, models, embeddings, image, audio }

  constructor(provider) {
    this.p = provider;
    this.kind = provider.providerType || 'openai';
  }

  endpoint(kind) {
    const o = this.p.endpoints || {};
    return o[kind] || this.constructor.defaults[kind] || '';
  }

  url(kind, model) {
    let ep = this.endpoint(kind);
    if (!ep) return '';
    if (model) ep = ep.replace('{model}', encodeURIComponent(model));
    return joinUrl(this.p.baseUrl, ep);
  }

  /** Auth + content-type + user custom headers. Overridden per type. */
  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json' };
    if (this.p.apiKey) h.Authorization = `Bearer ${this.p.apiKey}`;
    return { ...h, ...(this.p.headers || {}), ...extra };
  }

  modelName(model) {
    return model || this.p.model || '';
  }

  // Interface — subclasses override.
  async discoverModels() {
    return { discovered: false, models: [], message: MANUAL_MSG };
  }
  async chat() {
    return { content: '', toolCalls: [], error: 'chat not implemented for this provider type' };
  }
  async embeddings() {
    throw new Error('Embeddings are not supported by this provider type.');
  }
  async images() {
    throw new Error('Image generation is not supported by this provider type.');
  }
  async audio() {
    throw new Error('Audio is not supported by this provider type.');
  }
}

// ── OpenAI-compatible (also parent of OpenRouter / Groq / Azure / local) ──────

export class OpenAIAdapter extends BaseAdapter {
  static defaults = {
    models: '/models',
    chat: '/chat/completions',
    embeddings: '/embeddings',
    image: '/images/generations',
    audio: '/audio/speech',
  };

  headers(extra = {}) {
    const h = super.headers(extra);
    // Harmless elsewhere; OpenRouter uses these for attribution.
    h['HTTP-Referer'] = h['HTTP-Referer'] || 'http://localhost:5173';
    h['X-Title'] = h['X-Title'] || 'Jarvis Agentic OS';
    return h;
  }

  /** Candidate model endpoints — user override first, then the common cascade. */
  modelEndpoints() {
    const override = (this.p.endpoints || {}).models;
    const cascade = ['/models', '/v1/models', '/api/models', '/v2/models'];
    return override ? [override, ...cascade] : cascade;
  }

  async discoverModels() {
    let lastStatus = 0;
    for (const ep of this.modelEndpoints()) {
      const r = await tryJson(joinUrl(this.p.baseUrl, ep), this.headers());
      lastStatus = r.status || lastStatus;
      if (r.ok && r.json) {
        const rows = Array.isArray(r.json) ? r.json : r.json.data || r.json.models || [];
        let models = normalizeModelRows(rows, this.kind);
        if (this.kind === 'openrouter' && !models.some((m) => m.id === 'openrouter/auto')) {
          models.unshift({ id: 'openrouter/auto', label: 'Auto (router picks)', free: false });
        }
        if (models.length) return { discovered: true, models, endpoint: ep };
      }
    }
    return { discovered: false, models: [], message: DISCOVERY_UNAVAILABLE_MSG, status: lastStatus };
  }

  toOpenAIMessages(messages) {
    return messages; // already OpenAI-shaped
  }

  async chat({ model, messages, tools, onChunk = () => {}, signal }) {
    const body = { model: this.modelName(model), messages: this.toOpenAIMessages(messages), stream: true };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const url = this.url('chat', this.modelName(model));
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') return { content: '', toolCalls: [], aborted: true };
      return { content: '', toolCalls: [], error: `chat request failed: ${e.message}` };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { content: '', toolCalls: [], error: `chat ${res.status}: ${String(t).slice(0, 300)}` };
    }

    let content = '';
    const toolCalls = [];
    try {
      for await (const line of streamLines(res)) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices?.[0]?.delta || {};
          if (d.content) {
            content += d.content;
            onChunk(d.content);
          }
          for (const tc of d.tool_calls || []) {
            const i = tc.index ?? 0;
            toolCalls[i] = toolCalls[i] || { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) toolCalls[i].id = tc.id;
            if (tc.function?.name) toolCalls[i].function.name = tc.function.name;
            if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
          }
        } catch {
          /* partial frame */
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) return { content, toolCalls: toolCalls.filter(Boolean), aborted: true };
      throw e;
    }
    return { content, toolCalls: toolCalls.filter(Boolean) };
  }

  async embeddings({ model, input }) {
    const res = await fetch(this.url('embeddings'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.modelName(model), input }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    return res.json();
  }

  async images({ model, prompt, ...rest }) {
    const res = await fetch(this.url('image'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.modelName(model), prompt, ...rest }),
    });
    if (!res.ok) throw new Error(`images ${res.status}`);
    return res.json();
  }
}

// OpenRouter / Groq are OpenAI-compatible; distinct classes let free-tier + quirks diverge.
export class OpenRouterAdapter extends OpenAIAdapter {}
export class GroqAdapter extends OpenAIAdapter {}

// ── Azure OpenAI ─────────────────────────────────────────────────────────────

export class AzureAdapter extends OpenAIAdapter {
  apiVersion() {
    return this.p.apiVersion || (this.p.headers || {})['api-version'] || '2024-06-01';
  }
  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...(this.p.headers || {}), ...extra };
    if (this.p.apiKey) h['api-key'] = this.p.apiKey; // Azure uses api-key, not Bearer
    return h;
  }
  url(kind, model) {
    const o = this.p.endpoints || {};
    if (o[kind]) return joinUrl(this.p.baseUrl, o[kind].replace('{model}', encodeURIComponent(model || '')));
    const v = this.apiVersion();
    if (kind === 'chat')
      return joinUrl(this.p.baseUrl, `/openai/deployments/${encodeURIComponent(model || '')}/chat/completions?api-version=${v}`);
    if (kind === 'models') return joinUrl(this.p.baseUrl, `/openai/models?api-version=${v}`);
    if (kind === 'embeddings')
      return joinUrl(this.p.baseUrl, `/openai/deployments/${encodeURIComponent(model || '')}/embeddings?api-version=${v}`);
    return '';
  }
  modelEndpoints() {
    return [(this.p.endpoints || {}).models || `/openai/models?api-version=${this.apiVersion()}`];
  }
}

// ── Anthropic ────────────────────────────────────────────────────────────────

export class AnthropicAdapter extends BaseAdapter {
  static defaults = { models: '/v1/models', chat: '/v1/messages' };

  headers(extra = {}) {
    const h = {
      'Content-Type': 'application/json',
      'anthropic-version': (this.p.headers || {})['anthropic-version'] || '2023-06-01',
      ...(this.p.headers || {}),
      ...extra,
    };
    if (this.p.apiKey) h['x-api-key'] = this.p.apiKey;
    return h;
  }

  async discoverModels() {
    const r = await tryJson(this.url('models'), this.headers());
    if (r.ok && r.json) {
      const models = normalizeModelRows(r.json.data || r.json.models || [], 'anthropic');
      if (models.length) return { discovered: true, models };
    }
    return { discovered: false, models: [], message: DISCOVERY_UNAVAILABLE_MSG, status: r.status };
  }

  /** Split OpenAI-style messages into Anthropic's {system, messages[]}. */
  toAnthropic(messages) {
    let system = '';
    const out = [];
    for (const m of messages) {
      if (m.role === 'system') { system += (system ? '\n' : '') + (m.content || ''); continue; }
      if (m.role === 'tool') { out.push({ role: 'user', content: `Tool result: ${m.content}` }); continue; }
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content ?? '' });
    }
    return { system, messages: out };
  }

  async chat({ model, messages, onChunk = () => {}, signal }) {
    const { system, messages: msgs } = this.toAnthropic(messages);
    const body = {
      model: this.modelName(model),
      max_tokens: this.p.maxTokens || 4096,
      messages: msgs,
      stream: true,
    };
    if (system) body.system = system;
    let res;
    try {
      res = await fetch(this.url('chat'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') return { content: '', toolCalls: [], aborted: true };
      return { content: '', toolCalls: [], error: `chat request failed: ${e.message}` };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { content: '', toolCalls: [], error: `chat ${res.status}: ${String(t).slice(0, 300)}` };
    }
    let content = '';
    try {
      for await (const line of streamLines(res)) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        try {
          const j = JSON.parse(data);
          // content_block_delta → { delta: { type:'text_delta', text } }
          const text = j.delta?.text || (j.type === 'content_block_delta' ? j.delta?.text : '') || '';
          if (text) { content += text; onChunk(text); }
        } catch {
          /* partial */
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) return { content, toolCalls: [], aborted: true };
      throw e;
    }
    return { content, toolCalls: [] };
  }
}

// ── Gemini (Google Generative Language) ──────────────────────────────────────

export class GeminiAdapter extends BaseAdapter {
  static defaults = {
    models: '/v1beta/models',
    chat: '/v1beta/models/{model}:streamGenerateContent',
  };

  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...(this.p.headers || {}), ...extra };
    if (this.p.apiKey) h['x-goog-api-key'] = this.p.apiKey; // key via header, not URL
    return h;
  }

  async discoverModels() {
    const r = await tryJson(this.url('models'), this.headers());
    if (r.ok && r.json) {
      const rows = (r.json.models || []).filter(
        (m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'),
      );
      const models = normalizeModelRows(rows, 'gemini');
      if (models.length) return { discovered: true, models };
    }
    return { discovered: false, models: [], message: DISCOVERY_UNAVAILABLE_MSG, status: r.status };
  }

  toGemini(messages) {
    const contents = [];
    let systemInstruction;
    for (const m of messages) {
      if (m.role === 'system') { systemInstruction = { parts: [{ text: m.content || '' }] }; continue; }
      const role = m.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: m.role === 'tool' ? `Tool result: ${m.content}` : m.content ?? '' }] });
    }
    return { contents, systemInstruction };
  }

  async chat({ model, messages, onChunk = () => {}, signal }) {
    const mdl = this.modelName(model);
    const { contents, systemInstruction } = this.toGemini(messages);
    const body = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    // ?alt=sse makes streamGenerateContent emit Server-Sent Events.
    const url = this.url('chat', mdl) + (this.url('chat', mdl).includes('?') ? '&' : '?') + 'alt=sse';
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') return { content: '', toolCalls: [], aborted: true };
      return { content: '', toolCalls: [], error: `chat request failed: ${e.message}` };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { content: '', toolCalls: [], error: `chat ${res.status}: ${String(t).slice(0, 300)}` };
    }
    let content = '';
    try {
      for await (const line of streamLines(res)) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        try {
          const j = JSON.parse(data);
          const parts = j.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.text) { content += part.text; onChunk(part.text); }
          }
        } catch {
          /* partial */
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) return { content, toolCalls: [], aborted: true };
      throw e;
    }
    return { content, toolCalls: [] };
  }
}

// ── Ollama (native API) ──────────────────────────────────────────────────────

export class OllamaAdapter extends BaseAdapter {
  static defaults = { models: '/api/tags', chat: '/api/chat', embeddings: '/api/embeddings' };

  async discoverModels() {
    const r = await tryJson(this.url('models'), this.headers());
    if (r.ok && r.json) {
      const models = normalizeModelRows(r.json.models || [], 'ollama');
      if (models.length) return { discovered: true, models };
    }
    return { discovered: false, models: [], message: DISCOVERY_UNAVAILABLE_MSG, status: r.status };
  }

  async chat({ model, messages, onChunk = () => {}, signal }) {
    const body = {
      model: this.modelName(model),
      messages: messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content ?? '' })),
      stream: true,
    };
    let res;
    try {
      res = await fetch(this.url('chat'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') return { content: '', toolCalls: [], aborted: true };
      return { content: '', toolCalls: [], error: `chat request failed: ${e.message}` };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { content: '', toolCalls: [], error: `chat ${res.status}: ${String(t).slice(0, 300)}` };
    }
    let content = '';
    // Ollama streams NDJSON: one JSON object per line, { message: { content }, done }.
    try {
      for await (const line of streamLines(res)) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          const text = j.message?.content || '';
          if (text) { content += text; onChunk(text); }
        } catch {
          /* partial */
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) return { content, toolCalls: [], aborted: true };
      throw e;
    }
    return { content, toolCalls: [] };
  }

  async embeddings({ model, input }) {
    const res = await fetch(this.url('embeddings'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.modelName(model), prompt: input }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    return res.json();
  }
}

// ── Custom REST — user-configurable, OpenAI-shaped by default ─────────────────

export class CustomAdapter extends OpenAIAdapter {
  // Inherits OpenAI request/response shape but relies entirely on user-provided
  // endpoints. If no models endpoint is configured, discovery is manual-only.
  async discoverModels() {
    const override = (this.p.endpoints || {}).models;
    if (!override) return { discovered: false, models: [], message: MANUAL_MSG };
    return super.discoverModels();
  }
}

// ── Registry + factory ───────────────────────────────────────────────────────

const REGISTRY = {
  openai: OpenAIAdapter,
  openrouter: OpenRouterAdapter,
  groq: GroqAdapter,
  azure: AzureAdapter,
  anthropic: AnthropicAdapter,
  gemini: GeminiAdapter,
  ollama: OllamaAdapter,
  custom: CustomAdapter,
};

/** Build the adapter for a stored provider. Unknown falls back to OpenAI shape. */
export function getAdapter(provider) {
  const Adapter = REGISTRY[provider.providerType] || OpenAIAdapter;
  return new Adapter(provider);
}

/** Heuristic type from the base URL (used to seed Auto Detect). */
export function guessTypeFromUrl(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (u.includes('anthropic')) return 'anthropic';
  if (u.includes('generativelanguage') || u.includes('googleapis')) return 'gemini';
  if (u.includes('openrouter')) return 'openrouter';
  if (u.includes('groq')) return 'groq';
  if (u.includes('azure') || u.includes('.openai.azure.com')) return 'azure';
  if (u.includes('11434') || u.includes('ollama')) return 'ollama';
  return 'openai';
}

/**
 * Auto-detect a provider's type + models WITHOUT rejecting it. Tries the URL
 * heuristic first, then a cascade of typed adapters. Whatever happens, returns a
 * usable providerType and a message when discovery didn't work (manual mode).
 */
export async function autoDetect(spec) {
  const hinted = guessTypeFromUrl(spec.baseUrl);
  // Order: the URL's hinted type, then OpenAI cascade, then the natives, then custom.
  const order = [...new Set([hinted, 'openai', 'ollama', 'anthropic', 'gemini'])];
  for (const type of order) {
    const adapter = getAdapter({ ...spec, providerType: type });
    const res = await adapter.discoverModels().catch(() => ({ discovered: false }));
    if (res.discovered) {
      return { providerType: type, models: res.models, discovered: true };
    }
  }
  // Nothing discovered — keep the provider, manual mode. Prefer the URL hint so the
  // right request builder is used even though we couldn't list models.
  return {
    providerType: hinted !== 'openai' ? hinted : 'openai',
    models: [],
    discovered: false,
    message: DISCOVERY_UNAVAILABLE_MSG,
  };
}
