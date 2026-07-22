/**
 * Central Plugins registry.
 *
 * Structurally identical to the MCP registry, but manages plugins.
 * Uses a per-project enable map, matching the Skills implementation.
 *
 * Registry file: {projectsRoot}/.jarvis-brain/plugins.json
 * Each plugin: { id, name, label, enabled } (plus plugin-specific payload)
 */

import fs from 'node:fs';
import path from 'node:path';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';
const STORE = path.join(PROJECTS_ROOT, '.jarvis-brain', 'plugins.json');
const PLUGINS_DIR = path.join(PROJECTS_ROOT, '.jarvis-brain', 'plugins');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return { registry: [], state: {} };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function slugify(s) {
  return String(s || 'plugin').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveState(state, id, folder) {
  const projectState = folder ? state[folder] : undefined;
  if (projectState && projectState[id] !== undefined) return projectState[id];
  const defaultState = state['_default'];
  if (defaultState && defaultState[id] !== undefined) return defaultState[id];
  return true; // enabled by default
}

export function listPlugins(folder) {
  const data = load();
  return data.registry.map((p) => ({
    ...p,
    enabled: resolveState(data.state, p.id, folder),
  }));
}

/**
 * Add a plugin.
 * @param {{name, [key: string]: any}} spec
 */
export function addPlugin(spec, folder) {
  const data = load();
  const id = slugify(spec.name || spec.id);
  const plugin = {
    id,
    name: slugify(spec.name || id),
    label: spec.name || id,
    ...spec,
  };
  delete plugin.enabled; // handled by state
  
  const nextRegistry = data.registry.filter((s) => s.id !== id);
  nextRegistry.push(plugin);
  data.registry = nextRegistry;
  
  if (spec.enabled !== undefined) {
      const target = folder || '_default';
      if (!data.state[target]) data.state[target] = {};
      data.state[target][id] = !!spec.enabled;
  }
  
  save(data);
  return { plugin };
}

export function removePlugin(id, folder) {
  const data = load();
  const plugin = data.registry.find((s) => s.id === id);
  data.registry = data.registry.filter((s) => s.id !== id);
  
  // Clean up state
  for (const k of Object.keys(data.state)) {
    if (data.state[k][id] !== undefined) delete data.state[k][id];
  }
  
  save(data);
  return { removed: !!plugin };
}

export function setEnabled(id, enabled, folder) {
  const data = load();
  const target = folder || '_default';
  if (!data.state[target]) data.state[target] = {};
  data.state[target][id] = !!enabled;
  save(data);
  return {};
}
