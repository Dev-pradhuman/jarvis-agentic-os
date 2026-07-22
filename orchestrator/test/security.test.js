import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projectPath } from '../src/security.js';

const root = path.resolve('C:/projects');
test('allows a child folder', () => assert.equal(projectPath(root, 'Jarvis-os'), path.join(root, 'Jarvis-os')));
test('rejects traversal', () => assert.throws(() => projectPath(root, '../outside')));
test('rejects absolute folder', () => assert.throws(() => projectPath(root, 'C:/outside')));
