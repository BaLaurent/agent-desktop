#!/usr/bin/env node

/**
 * Build better-sqlite3 for both Electron and Node.js ABIs.
 *
 * Electron-rebuild compiles for the Electron ABI (used by the app at runtime).
 * npm rebuild recompiles for the host Node.js ABI (used by Vitest).
 *
 * Backups are stored in .native-cache/ (outside node_modules/better-sqlite3/build
 * which gets cleaned by npm rebuild). The pretest/posttest scripts swap them in.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(
  ROOT,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release'
);
const BINARY = path.join(RELEASE_DIR, 'better_sqlite3.node');

const CACHE_DIR = path.join(__dirname, '.native-cache');
const ELECTRON_BACKUP = path.join(CACHE_DIR, 'better_sqlite3.electron.node');
const NATIVE_BACKUP = path.join(CACHE_DIR, 'better_sqlite3.native.node');

const run = (cmd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
};

fs.mkdirSync(CACHE_DIR, { recursive: true });

// Step 1: Build for Electron
console.log('\n=== Building better-sqlite3 for Electron ===');
run('npx electron-rebuild -f -w better-sqlite3');
fs.copyFileSync(BINARY, ELECTRON_BACKUP);
console.log('  Saved electron binary to .native-cache/');

// Step 2: Rebuild for Node.js (this cleans the build/ dir)
console.log('\n=== Building better-sqlite3 for Node.js ===');
run('npm rebuild better-sqlite3');
fs.copyFileSync(BINARY, NATIVE_BACKUP);
console.log('  Saved native binary to .native-cache/');

// Step 3: Restore Electron as default (app runtime needs it)
fs.copyFileSync(ELECTRON_BACKUP, BINARY);
console.log('\n=== Restored Electron binary as default ===');
console.log('Done. Both ABIs available for swap.');
