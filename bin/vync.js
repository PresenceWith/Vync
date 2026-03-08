#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');

const projectRoot = process.env.VYNC_HOME || path.resolve(__dirname, '..');
const tsx = path.join(projectRoot, 'node_modules', '.bin', 'tsx');
const main = path.join(projectRoot, 'tools', 'cli', 'main.ts');

try {
  execFileSync(tsx, [main, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: {
      ...process.env,
      VYNC_HOME: projectRoot,
      VYNC_CALLER_CWD: process.cwd(),
    },
  });
} catch (e) {
  process.exit(e.status || 1);
}
