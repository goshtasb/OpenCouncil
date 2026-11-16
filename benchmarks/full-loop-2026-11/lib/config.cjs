#!/usr/bin/env node
'use strict';
// Writes the council config for one arm: the profile's numbers as `council init` (0.4.0) writes them, with
// the seats for that arm, `npm test` as the only gate, no dependency install, no auto-merge, no
// failover to another provider (a failed seat makes the run unscored instead of quietly changing the arm).
//   node config.cjs <mixed|solo> <file> <lead model> <engineer model> <grok model> <solo side model> [quick|full]
const fs = require('fs');
const [arm, file, lead, engineer, grok, side, profile = 'full'] = process.argv.slice(2);
// The two profiles as `council init` (0.4.0) writes them.
const P = profile === 'full'
  ? { max_rounds: 10, tiebreak_round: 7, round_timeout_seconds: 900, signoff_revisions: 2, profile: 'full' }
  : { max_rounds: 4, tiebreak_round: 3, round_timeout_seconds: 600, signoff_revisions: 1, profile: 'quick' };
const seat = (provider, model, persona) => `    provider: "${provider}"\n    model: "${model}"\n    persona: ".council/personas/${persona}.md"`;
const leadSeat = arm === 'mixed' ? seat('antigravity', lead, 'lead-pm') : seat('claude-code', side, 'lead-pm');
const archSeat = arm === 'mixed' ? seat('grok-cli', grok || 'grok-4.6', 'chief-architect') : seat('claude-code', side, 'chief-architect');
const yml = `version: 1
project:
  name: "benchmark task"
  base_branch: "main"
  package_manager: "npm"
  install_command: ""
  test_command: "npm test"
  lint_command: ""
council:
  max_rounds: ${P.max_rounds}
  tiebreak_round: ${P.tiebreak_round}
  round_timeout_seconds: ${P.round_timeout_seconds}
  execution_timeout_seconds: 3600
  execution_attempts: 3
  signoff_revisions: ${P.signoff_revisions}
  no_progress_rounds: 3
  profile: "${P.profile}"
  seat_failover: false
seats:
  lead_pm:
${leadSeat}
  chief_engineer:
${seat('claude-code', engineer, 'chief-engineer')}
  chief_architect:
${archSeat}
verification:
  fail_fast: false
  merge_base: true
  gates:
    - name: "test"
      command: "npm test"
      standard: "12-point #4 Testing & Release Engineering"
backlog:
  wip_limit: 1
  auto_merge_dev: false
office:
  port: 4321
  auto_open: false
`;
fs.mkdirSync(require('path').dirname(file), { recursive: true });
fs.writeFileSync(file, yml);
