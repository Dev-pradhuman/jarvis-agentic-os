import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE = path.join(process.env.JARVIS_PROJECTS_ROOT || 'C:\\Users\\Pradhuman\\projects', '.jarvis-brain', 'approvals.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const save = (items) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(items, null, 2)); };
export function listApprovals() { return load().slice().reverse(); }
export function requestApproval(type, payload, folder = '') { const item = { id: randomUUID(), type, payload, folder, status: 'pending', createdAt: Date.now() }; const all = load(); all.push(item); save(all); return item; }
export function decideApproval(id, approved) { const all = load(); const item = all.find((x) => x.id === id); if (!item || item.status !== 'pending') throw new Error('Approval is no longer pending.'); item.status = approved ? 'approved' : 'rejected'; item.decidedAt = Date.now(); save(all); return item; }
