import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig } from '../types.js';
import { getTemplatesDir } from '../config.js';

/** Looks in '.council' first, then the pre-rename '.councilmen', so existing projects keep working. */
function projectDir(repoRoot: string, sub: string): string {
  for (const base of ['.council', '.councilmen']) {
    const candidate = sub ? path.join(repoRoot, base, sub) : path.join(repoRoot, base);
    if (fs.existsSync(candidate)) return candidate;
  }
  return sub ? path.join(repoRoot, '.council', sub) : path.join(repoRoot, '.council');
}

function projectFile(repoRoot: string, sub: string, file: string): string {
  return path.join(projectDir(repoRoot, sub), file);
}

export type SeatName = keyof CouncilConfig['seats'];
export type ContractName = 'member' | 'tiebreak' | 'review' | 'execution' | 'question';

const DEFAULT_PERSONA_FILES: Record<SeatName, string> = {
  lead_pm: 'lead-pm.md',
  chief_engineer: 'chief-engineer.md',
  chief_architect: 'chief-architect.md'
};

function readFirstExisting(candidates: string[], what: string): string {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(`Could not find ${what}. Looked in: ${candidates.filter(Boolean).join(', ')}`);
}

export function loadPersona(config: CouncilConfig, seat: SeatName, repoRoot: string): string {
  const configured = config.seats[seat]?.persona;
  const configuredPath = configured ? (path.isAbsolute(configured) ? configured : path.join(repoRoot, configured)) : '';
  return readFirstExisting(
    [configuredPath, path.join(getTemplatesDir(), 'personas', DEFAULT_PERSONA_FILES[seat])],
    `persona for seat '${seat}'`
  );
}

export function loadContract(name: ContractName, repoRoot: string): string {
  const file = `${name}-contract.md`;
  return readFirstExisting(
    [projectFile(repoRoot, 'references', file), path.join(getTemplatesDir(), 'references', file)],
    `contract '${file}'`
  );
}

export function loadConstitution(repoRoot: string): string | null {
  const file = projectFile(repoRoot, '', 'CONSTITUTION.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/**
 * Engineering standards (00-manifest.md plus sub-standards). A project's own `.council/standards/`
 * replaces the packaged defaults entirely, so a project never gets a mix of two standard sets.
 */
export function loadStandards(repoRoot: string): Array<{ file: string; content: string }> {
  const projectStandards = projectDir(repoRoot, 'standards');
  const dir = fs.existsSync(projectStandards) ? projectStandards : path.join(getTemplatesDir(), 'standards');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(file => ({ file, content: fs.readFileSync(path.join(dir, file), 'utf8') }));
}

export function buildSystemPrompt(config: CouncilConfig, seat: SeatName, contract: ContractName | null, repoRoot: string): string {
  const parts = [loadPersona(config, seat, repoRoot)];
  if (contract) parts.push(loadContract(contract, repoRoot));
  const constitution = loadConstitution(repoRoot);
  if (constitution) parts.push(constitution);
  const standards = loadStandards(repoRoot);
  if (standards.length > 0) {
    parts.push(
      [
        '# Project Engineering Standards',
        'These standards bind every council seat. The numbers map to names: 00 = Manifest, 01 = Architecture, 02 = Coding Practices, 03 = Documentation. Start from 00 Manifest to decide which standards apply, and cite rules by number, name and section (e.g. "02 Coding Practices §3").',
        ...standards.map(s => `<standard file="${s.file}">\n${s.content.trim()}\n</standard>`)
      ].join('\n\n')
    );
  }
  return parts.join('\n\n---\n\n');
}

// Accepts em dash, en dash or a spaced hyphen as the field separator models emit.
export const FIELD_SEPARATOR = String.raw`\s+[—–-]\s+|\s*[—–]\s*`;

/**
 * Splits a model reply into trimmed lines, first breaking before protocol markers that a model
 * glued onto the end of a sentence (e.g. "…evidence-based.CONCERN 1: REQUIRED …").
 */
export function protocolLines(reply: string): string[] {
  return reply
    .replace(/[*`_#>]/g, '')
    .replace(/(\S)[ \t]*(?=\b(?:CONCERN\s+\d+\s*:|RULING\s+\d+\s*:|ANSWER\s+\d+\s*:|QUESTION FOR ARCHITECT\b|VERDICT\s*:|OPEN OBJECTIONS\s*:|SUMMARY\s*:))/g, '$1\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}
