#!/usr/bin/env node

import('../dist/cli.js').catch((err) => {
  console.error('Failed to run Open Council:', err);
  process.exit(1);
});
