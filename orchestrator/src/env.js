import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Always load the orchestrator's local configuration, regardless of whether the
// process was launched from this folder, the repository root, or a shortcut.
export const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
// A stale empty shell variable must not hide a real value saved by Jarvis setup.
dotenv.config({ path: ENV_FILE, override: true });
