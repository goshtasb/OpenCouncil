import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { CouncilConfig } from './types.js';

export const DEFAULT_CONFIG: CouncilConfig = {
  version: 1,
  project: {
    name: 'Open Councilmen Project',
    base_branch: 'main',
    package_manager: 'npm',
    install_command: 'npm install',
    test_command: 'npm test',
    lint_command: 'npm run lint'
  },
  council: {
    max_rounds: 10,
    tiebreak_round: 7,
    round_timeout_seconds: 900
  },
  seats: {
    lead_pm: {
      provider: 'gemini-cli',
      model: 'gemini-2.0-flash',
      persona: '.councilmen/personas/lead-pm.md'
    },
    chief_engineer: {
      provider: 'claude-code',
      model: 'claude-3-7-sonnet',
      persona: '.councilmen/personas/chief-engineer.md'
    },
    chief_architect: {
      provider: 'grok-cli',
      model: 'grok-4',
      persona: '.councilmen/personas/chief-architect.md'
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
    const candidate = path.join(curr, '.councilmen', 'config.yml');
    if (fs.existsSync(candidate)) return candidate;
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
    const parsed = yaml.load(content) as Partial<CouncilConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      project: { ...DEFAULT_CONFIG.project, ...parsed.project },
      council: { ...DEFAULT_CONFIG.council, ...parsed.council },
      seats: { ...DEFAULT_CONFIG.seats, ...parsed.seats },
      backlog: { ...DEFAULT_CONFIG.backlog, ...parsed.backlog },
      office: { ...DEFAULT_CONFIG.office, ...parsed.office }
    };
  } catch (err) {
    console.warn(`Failed to parse ${configFile}, using default configuration.`);
    return DEFAULT_CONFIG;
  }
}

export function getTemplatesDir(): string {
  // Try package templates dir or local templates dir
  const localTemplate = path.resolve(__dirname, '..', 'templates');
  if (fs.existsSync(localTemplate)) return localTemplate;
  return path.resolve(__dirname, 'templates');
}
