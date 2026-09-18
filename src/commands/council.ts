import { Command } from 'commander';
import * as fs from 'fs';
import { CouncilEngine } from '../engine/council.js';
import { DeliberationEngine } from '../engine/deliberation.js';
import { TieBreakEngine } from '../engine/tiebreak.js';
import { ArchitectureReviewEngine } from '../engine/review.js';
import { LeadSignoffEngine } from '../engine/signoff.js';
import { CliContext, action, readStdin } from './shared.js';

export function registerCouncilCommands(program: Command, ctx: CliContext): void {
  program
    .command('open <slug>')
    .description('Open a new council session in a pristine worktree')
    .option('-t, --task <text>', 'Task statement for the council')
    .option('-f, --task-file <path>', 'Read the task statement from a file')
    .option('-i, --item <id>', 'Take the task from a backlog item (enforces the WIP limit)')
    .action(action(async (slug: string, options: { task?: string; taskFile?: string; item?: string }) => {
      const task = options.taskFile ? fs.readFileSync(options.taskFile, 'utf8') : options.task;
      const sessionId = await new CouncilEngine(ctx.config).open(ctx.repoRoot, slug, { task, backlogItem: options.item });
      console.log(sessionId);
    }));

  program
    .command('deliberate <session>')
    .description('Run the full council loop: Lead PM drafts, Chief Engineer rounds, tie-breaks, Chief Architect and Lead sign-off, finalize')
    .action(action(async (sessionId: string) => {
      const result = await new DeliberationEngine(ctx.config).run(sessionId);
      if (result.outcome === 'AWAITING_APPROVAL') {
        console.log(`\nAgreed and signed off after ${result.rounds} round(s).`);
        console.log(`Deliverable: ${result.deliverable}`);
        console.log(`PDF for approval: ${result.deliverablePdf}`);
        console.log(`Review it:  council prd ${sessionId}`);
        console.log(`Approve it: council approve ${sessionId} "${result.approvalToken}"`);
      } else {
        console.log(`\nSTALLED after ${result.rounds} round(s): ${result.reason}`);
        process.exitCode = 2;
      }
    }));

  program
    .command('draft <session>')
    .description('Manually save the next plan draft (or --changes notes) from stdin')
    .option('--changes', 'Save as changes notes instead of a plan')
    .action(action(async (sessionId: string, options: { changes?: boolean }) => {
      const content = await readStdin();
      if (!content.trim()) throw new Error('No draft provided on stdin.');
      const file = new CouncilEngine(ctx.config).saveDraft(sessionId, options.changes ? 'changes' : 'plan', content);
      console.log(`Saved: ${file}`);
    }));

  program
    .command('ask <session>')
    .description('Manually submit a round prompt (stdin) to the Chief Engineer')
    .action(action(async (sessionId: string) => {
      const prompt = await readStdin();
      if (!prompt.trim()) throw new Error('No prompt provided on stdin.');
      const verdict = await new CouncilEngine(ctx.config).askRound(sessionId, prompt);
      console.log(`\nVERDICT: ${verdict.verdict}`);
      console.log(`OPEN OBJECTIONS: ${verdict.openObjections === 999 ? 'unparseable' : verdict.openObjections}`);
      console.log(`CONVERGED: ${verdict.converged ? 'yes' : 'no'}`);
    }));

  program
    .command('tiebreak <session>')
    .description('Invoke the Chief Architect for binding tie-breaking arbitration')
    .action(action(async (sessionId: string) => {
      const res = await new TieBreakEngine(ctx.config).runTieBreak(sessionId);
      console.log(`\nChief Architect Rulings (${res.rulingsCount} rulings, ${res.expectedObjections} objections):`);
      for (const r of res.rulings) console.log(`RULING ${r.id}: ${r.ruling} — ${r.reason}`);
      console.log(`SUMMARY: ${res.summary}`);
    }));

  program
    .command('review <session>')
    .description('Invoke the Chief Architect for 12-point industry standards sign-off')
    .action(action(async (sessionId: string) => {
      const res = await new ArchitectureReviewEngine(ctx.config).runReview(sessionId);
      console.log(`\nArchitecture Review Verdict: ${res.verdict}`);
      console.log(`Required Concerns: ${res.requiredConcerns}, Advisory Concerns: ${res.advisoryConcerns}`);
      for (const c of res.concerns) console.log(`CONCERN ${c.id}: ${c.type} — ${c.principle} — ${c.description}`);
      console.log(`SUMMARY: ${res.summary}`);
    }));

  program
    .command('signoff <session>')
    .description('Ask the Council Lead for the final sign-off (after Chief Engineer ratification and Chief Architect sign-off)')
    .action(action(async (sessionId: string) => {
      const res = await new LeadSignoffEngine(ctx.config).runSignoff(sessionId);
      console.log(`\nCouncil Lead Verdict: ${res.verdict}`);
      if (res.summary) console.log(`SUMMARY: ${res.summary}`);
    }));

  program
    .command('finalize <session>')
    .description('Finalize the deliverable for the Operator (requires sign-off from all three council seats on the same version)')
    .action(action((sessionId: string) => {
      const file = new CouncilEngine(ctx.config).finalize(sessionId);
      console.log(`Finalized deliverable: ${file}`);
    }));

  program
    .command('prd <session>')
    .description('Present the final PRD the council signed off, for Operator review before approval')
    .option('--path-only', 'Print only the file path')
    .option('--pdf', 'Regenerate and print the path of the approval PDF')
    .action(action(async (sessionId: string, options: { pathOnly?: boolean; pdf?: boolean }) => {
      const council = new CouncilEngine(ctx.config);
      const prd = council.deliverable(sessionId);
      if (options.pdf) {
        console.log(await council.writeDeliverablePdf(sessionId));
        return;
      }
      if (options.pathOnly) {
        console.log(prd.file);
        return;
      }
      console.log(prd.content);
      console.log(`\n--- Operator review ---`);
      console.log(`File: ${prd.file}`);
      console.log(`sha256: ${prd.prdSha256}`);
      console.log(`PDF: ${prd.file.replace(/\.md$/, '.pdf')} (regenerate with: council prd ${sessionId} --pdf)`);
      console.log(`No code is written until you approve: council approve ${sessionId} "${prd.approvalToken}"`);
    }));

  program
    .command('approve <session> <token>')
    .description('Approve the finalized deliverable with the operator token (APPROVE <sha8>)')
    .action(action((sessionId: string, token: string) => {
      new CouncilEngine(ctx.config).approve(sessionId, token);
    }));
}
