import { getRegistry } from './cli.js';
import { listMcp } from './mcp.js';
import { listPlugins } from './plugins.js';
import { listSkills } from './skillsManager.js';

export function capabilityAudit(folder = '') {
  const skills = listSkills(folder).filter((s) => s.enabled);
  const plugins = listPlugins(folder).filter((p) => p.enabled);
  const connectors = listMcp(folder).filter((m) => m.enabled);
  return getRegistry().map((cli) => ({ id: cli.id, label: cli.label, available: cli.available, memory: true, skills: skills.length, plugins: plugins.length, connectors: connectors.length }));
}
