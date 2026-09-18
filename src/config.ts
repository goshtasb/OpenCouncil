import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { CouncilConfig } from './types.js';

export const DEFAULT_CONFIG: CouncilConfig = {
  version: 1,
  project: {
    name: 'Open Council Project',
    base_branch: 'main',
    package_manager: 'npm',
    install_command: 'npm install',
    test_command: 'npm test',
    lint_command: ''
  },
  council: {
    max_rounds: 10,
    tiebreak_round: 7,
    round_timeout_seconds: 900,
    execution_timeout_seconds: 3600,
    execution_attempts: 3,
    signoff_revisions: 2
  },
  seats: {
    lead_pm: {
      provider: 'antigravity',
      model: 'gemini-3.1-pro-high',
      persona: '.council/personas/lead-pm.md'
    },
    chief_engineer: {
      provider: 'claude-code',
      model: 'opus',
      persona: '.council/personas/chief-engineer.md'
    },
    chief_architect: {
      provider: 'grok-cli',
      model: 'grok-4.6',
      persona: '.council/personas/chief-architect.md'
    }
  },
  backlog: {
    wip_limit: 1,
    auto_merge_dev: true
  },
  office: {
    port: 4321,
    auto_open: true
  }
};

export function findConfigFile(startDir: string = process.cwd()): string | null {
  let curr = path.resolve(startDir);
  while (true) {
    // '.councilmen' is the pre-rename directory name, still read so existing projects keep working.
    for (const dir of ['.council', '.councilmen']) {
      const candidate = path.join(curr, dir, 'config.yml');
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

export function loadConfig(startDir: string = process.cwd()): CouncilConfig {
  const configFile = findConfigFile(startDir);
  if (!configFile) {
    return DEFAULT_CONFIG;
  }
  try {
    const content = fs.readFileSync(configFile, 'utf8');
    const parsed = (yaml.load(content) || {}) as Partial<CouncilConfig>;
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('the file must contain a YAML mapping');
    }
    if (parsed.verification?.gates !== undefined && !Array.isArray(parsed.verification.gates)) {
      throw new Error('verification.gates must be a list');
    }
    const seats = parsed.seats || ({} as Partial<CouncilConfig['seats']>);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      project: { ...DEFAULT_CONFIG.project, ...parsed.project },
      council: { ...DEFAULT_CONFIG.council, ...parsed.council },
      seats: {
        lead_pm: { ...DEFAULT_CONFIG.seats.lead_pm, ...seats.lead_pm },
        chief_engineer: { ...DEFAULT_CONFIG.seats.chief_engineer, ...seats.chief_engineer },
        chief_architect: { ...DEFAULT_CONFIG.seats.chief_architect, ...seats.chief_architect }
      },
      backlog: { ...DEFAULT_CONFIG.backlog, ...parsed.backlog },
      office: { ...DEFAULT_CONFIG.office, ...parsed.office }
    };
  } catch (err: any) {
    // Never silently fall back: a malformed config would drop the project's verification gates.
    throw new Error(`Failed to load ${configFile}: ${err.message}`);
  }
}

export function getTemplatesDir(): string {
  // Try package templates dir or local templates dir
  const localTemplate = path.resolve(__dirname, '..', 'templates');
  if (fs.existsSync(localTemplate)) return localTemplate;
  return path.resolve(__dirname, 'templates');
}
