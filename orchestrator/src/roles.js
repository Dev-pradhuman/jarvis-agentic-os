import fs from 'node:fs';
import path from 'node:path';
import { getRegistry } from './cli.js';
import { listProviders } from './providers.js';

const PROJECTS_ROOT = process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects';

function getStorePath(folder) {
  if (!folder) return path.join(PROJECTS_ROOT, '.jarvis-brain', 'roles.json');
  return path.join(PROJECTS_ROOT, '.jarvis-brain', 'folders', folder, 'roles.json');
}

const DEFAULT_ROLES = {
  enhancer: { kind: 'cli', id: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'low' },
  coder: { kind: 'cli', id: 'claude', model: 'claude-opus-4-8', effort: 'high' },
  // Intent classifier for the router. Defaults to the Claude CLI (its own auth),
  // so coder-switch works with no API key — reconfigurable to any CLI/provider.
  router: { kind: 'cli', id: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'low' }
};

function readRoles(folder) {
  try {
    const p = getStorePath(folder);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function getRoles(projectFolder) {
  const projectOverrides = projectFolder ? readRoles(projectFolder) : null;
  const globalRoles = readRoles('') || {};

  return {
    enhancer: projectOverrides?.enhancer || globalRoles.enhancer || DEFAULT_ROLES.enhancer,
    coder: projectOverrides?.coder || globalRoles.coder || DEFAULT_ROLES.coder,
    router: projectOverrides?.router || globalRoles.router || DEFAULT_ROLES.router
  };
}

const VALID_ROLES = new Set(['enhancer', 'coder', 'router']);

export function setRole(roleName, config, projectFolder) {
  if (!VALID_ROLES.has(roleName)) throw new Error('Invalid role');
  
  // Validate
  if (config.kind === 'cli') {
    const clis = getRegistry();
    const cli = clis.find(c => c.id === config.id);
    if (!cli || !cli.available) throw new Error(`CLI ${config.id} is not installed or available.`);
  } else if (config.kind === 'provider') {
    const providers = listProviders();
    const prov = providers.find(p => p.id === config.id);
    if (!prov) throw new Error(`Provider ${config.id} is not found.`);
  } else {
    throw new Error('Invalid kind. Must be cli or provider.');
  }

  const p = getStorePath(projectFolder);
  let current = {};
  try {
    if (fs.existsSync(p)) current = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}

  current[roleName] = config;
  
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(current, null, 2));

  return current;
}
