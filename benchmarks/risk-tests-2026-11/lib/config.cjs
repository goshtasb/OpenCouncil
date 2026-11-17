#!/usr/bin/env node
'use strict';
// Writes the .council/config.yml of the build arm: Gemini (Antigravity), Claude Code and Grok, `npm test` as the only
// gate, no dependency install, no failover to another company (a seat that fails is a gap the build reports, never a
// quiet swap), one risk round, five risks per seat at most.
//   node config.cjs <file> <lead model> <engineer model> <grok model>
const fs = require('fs');
const path = require('path');
const [file, lead, engineer, grok] = process.argv.slice(2);
const seat = (provider, model, persona) => `    provider: "${provider}"\n    model: "${model}"\n    persona: ".council/personas/${persona}.md"`;
const yml = `version: 1
project:
  name: "benchmark task"
  base_branch: "main"
  package_manager: "npm"
  install_command: ""
  test_command: "npm test"
  lint_command: ""
council:
  round_timeout_seconds: 900
  execution_timeout_seconds: 1800
  execution_attempts: 3
  seat_failover: false
seats:
  lead_pm:
${seat('antigravity', lead, 'lead-pm')}
  chief_engineer:
${seat('claude-code', engineer, 'chief-engineer')}
  chief_architect:
${seat('grok-cli', grok || 'grok-4.6', 'chief-architect')}
build:
  risk_rounds: 1
  risks_per_seat: 5
  risk_timeout_seconds: 600
verification:
  fail_fast: false
  merge_base: true
  gates:
    - name: "test"
      command: "npm test"
      standard: "12-point #4 Testing & Release Engineering"
`;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, yml);
