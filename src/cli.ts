import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, getTemplatesDir } from './config.js';
import { CouncilEngine } from './engine/council.js';
import { TieBreakEngine } from './engine/tiebreak.js';
import { ArchitectureReviewEngine } from './engine/review.js';
import { PipelineManager } from './engine/pipeline.js';
import { ExecutionEngine } from './engine/execution.js';
import { OfficeServer } from './office/server.js';
import { logger } from './utils/logger.js';

const program = new Command();
const config = loadConfig();

program
  .name('councilmen')
  .description('Open Councilmen — Autonomous Multi-Agent Deliberation & Execution Council')
  .version('0.1.0');

// Init command
program
  .command('init')
  .description('Initialize Open Councilmen templates in the current repository')
  .action(async () => {
    const targetDir = path.join(process.cwd(), '.councilmen');
    if (fs.existsSync(targetDir)) {
      logger.warn('.councilmen configuration already exists.');
      return;
    }
    const templatesDir = path.join(getTemplatesDir(), '.councilmen');
    const personasDir = path.join(getTemplatesDir(), 'personas');

    fs.mkdirSync(path.join(targetDir, 'personas'), { recursive: true });
    fs.copyFileSync(path.join(templatesDir, 'config.yml'), path.join(targetDir, 'config.yml'));
    fs.copyFileSync(path.join(templatesDir, 'CONSTITUTION.md'), path.join(targetDir, 'CONSTITUTION.md'));
    fs.copyFileSync(path.join(templatesDir, 'DELEGATION.md'), path.join(targetDir, 'DELEGATION.md'));

    for (const f of fs.readdirSync(personasDir)) {
      fs.copyFileSync(path.join(personasDir, f), path.join(targetDir, 'personas', f));
    }

    logger.success('Initialized .councilmen/ with configuration, constitution, and personas.');
  });

// Backlog commands
const backlog = program.command('backlog').description('Manage the agile council backlog (WIP=1)');

backlog
  .command('add <title>')
  .description('Add a new item to the backlog')
  .option('-p, --priority <number>', 'Priority (1-9)', '5')
  .option('-k, --kind <type>', 'Kind (feature, bug, refactor)', 'feature')
  .action(async (title, options) => {
    const pipeline = new PipelineManager();
    const item = pipeline.addItem(title, parseInt(options.priority, 10), '', options.kind);
    logger.success(`Added item ${item.id}: "${item.title}" [Priority ${item.priority}]`);
  });

backlog
  .command('list')
  .description('List all backlog items')
  .action(() => {
    const pipeline = new PipelineManager();
    const items = pipeline.listItems();
    if (items.length === 0) {
      console.log('Backlog is empty.');
      return;
    }
    console.log('\nID   STATUS             PRIORITY  TITLE');
    console.log('------------------------------------------------------------');
    for (const item of items) {
      const id = item.id.padEnd(4);
      const st = item.status.padEnd(18);
      const pr = `p${item.priority}`.padEnd(9);
      console.log(`${id} ${st} ${pr} ${item.title}`);
    }
    console.log('');
  });

// Council deliberation commands
program
  .command('open <slug>')
  .description('Open a new council deliberation session')
  .action(async (slug) => {
    const council = new CouncilEngine(config);
    const sessionId = await council.open(process.cwd(), slug);
    console.log(sessionId);
  });

program
  .command('ask <session>')
  .description('Submit round prompt to the Chief Engineer on stdin')
  .action(async (sessionId) => {
    let prompt = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      prompt += chunk;
    }
    if (!prompt.trim()) {
      logger.error('No prompt provided on stdin.');
      process.exit(1);
    }
    const council = new CouncilEngine(config);
    const verdict = await council.askRound(sessionId, prompt);
    console.log(`\nVERDICT: ${verdict.verdict}`);
    console.log(`OPEN OBJECTIONS: ${verdict.openObjections}`);
    console.log(`CONVERGED: ${verdict.converged ? 'yes' : 'no'}`);
  });

program
  .command('tiebreak <session>')
  .description('Invoke the Chief Architect for binding tie-breaking arbitration')
  .action(async (sessionId) => {
    const tb = new TieBreakEngine(config);
    const res = await tb.runTieBreak(sessionId);
    console.log(`\nChief Architect Rulings (${res.rulingsCount} rulings):`);
    for (const r of res.rulings) {
      console.log(`RULING ${r.id}: ${r.ruling} — ${r.reason}`);
    }
    console.log(`SUMMARY: ${res.summary}`);
  });

program
  .command('review <session>')
  .description('Invoke Chief Architect for 8-point industry standards sign-off')
  .action(async (sessionId) => {
    const rev = new ArchitectureReviewEngine(config);
    const res = await rev.runReview(sessionId);
    console.log(`\nArchitecture Review Verdict: ${res.verdict}`);
    console.log(`Required Concerns: ${res.requiredConcerns}, Advisory Concerns: ${res.advisoryConcerns}`);
    for (const c of res.concerns) {
      console.log(`CONCERN ${c.id}: ${c.type} — ${c.principle} — ${c.description}`);
    }
    console.log(`SUMMARY: ${res.summary}`);
  });

program
  .command('finalize <session>')
  .description('Finalize deliberated deliverable after consensus and sign-off')
  .action(async (sessionId) => {
    const council = new CouncilEngine(config);
    const file = council.finalize(sessionId);
    console.log(`Finalized deliverable: ${file}`);
  });

program
  .command('approve <session> <token>')
  .description('Approve finalized PRD with operator token (APPROVE <sha8>)')
  .action(async (sessionId, token) => {
    const council = new CouncilEngine(config);
    council.approve(sessionId, token);
  });

program
  .command('handoff <session>')
  .description('Handoff approved PRD to isolated execution worktree')
  .action(async (sessionId) => {
    const exec = new ExecutionEngine(config);
    const worktree = await exec.handoff(sessionId);
    console.log(`Ready in execution worktree: ${worktree}`);
  });

program
  .command('run <session>')
  .description('Launch autonomous execution in the worktree')
  .action(async (sessionId) => {
    const exec = new ExecutionEngine(config);
    const outcome = await exec.run(sessionId);
    console.log(`Execution finished with outcome: ${outcome}`);
  });

// Office UI command
program
  .command('office')
  .description('Launch the live retro pixel-art office web dashboard')
  .option('-p, --port <number>', 'Port to listen on', '4321')
  .action(async (options) => {
    const server = new OfficeServer(config);
    await server.start(parseInt(options.port, 10));
    console.log('Press Ctrl+C to stop office server.');
  });

program.parse(process.argv);
