#!/usr/bin/env node

if (process.platform === 'win32') {
  console.error('Open Council needs macOS or Linux; on Windows, run it inside WSL');
  process.exit(1);
}

import('../dist/cli.js').catch((err) => {
  console.error('Failed to run Open Council:', err);
  process.exit(1);
});
