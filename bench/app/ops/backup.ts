import { cpSync, mkdirSync } from 'node:fs';
import { config } from '../src/config.ts';

// Copies the current environment's data directory to backups/<env>-<timestamp>.
// Restore: stop the server, copy a backup directory over the data directory, start the server.
const target = `backups/${config.env}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync('backups', { recursive: true });
cpSync(config.dataDir, target, { recursive: true });
console.log(`Backed up ${config.dataDir} to ${target}`);
