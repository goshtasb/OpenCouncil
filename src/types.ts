export type VerdictType = 'SHIP IT' | 'SHIP WITH CHANGES' | 'RETHINK' | 'UNPARSEABLE';
export type ArchitectVerdictType = 'SIGN-OFF' | 'SIGN-OFF WITH CONCERNS' | 'RETHINK' | 'UNPARSEABLE';
export type TieBreakRuling = 'STANDS' | 'OVERRULED' | 'MEASURE';

export interface Objection {
  id: number;
  text: string;
  citation?: string;
  proposedChange?: string;
}

export interface RoundVerdict {
  round: number;
  verdict: VerdictType;
  openObjections: number;
  converged: boolean;
  replySha256: string;
  planSha256: string;
}

export interface TieBreakResult {
  round: number;
  expectedObjections: number;
  rulingsCount: number;
  rulings: Array<{
    id: number;
    ruling: TieBreakRuling;
    reason: string;
  }>;
  summary: string;
}

export interface ArchitectRuling {
  id: number;
  askedBy: string;
  stage: string;
  question: string;
  ruling: string;
}

export interface LeadSignoffResult {
  round: number;
  verdict: 'SIGN-OFF' | 'RETHINK' | 'UNPARSEABLE';
  summary: string;
  planSha256: string;
  replySha256: string;
}

export interface ArchitectureReviewResult {
  round: number;
  verdict: ArchitectVerdictType;
  requiredConcerns: number;
  advisoryConcerns: number;
  concerns: Array<{
    id: number;
    type: 'REQUIRED' | 'ADVISORY';
    principle: string;
    description: string;
  }>;
  summary: string;
  planSha256: string;
  replySha256: string;
}

export type SessionStatus = 
  | 'OPEN'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'STALLED'
  | 'IN_EXECUTION'
  | 'DONE'
  | 'BLOCKED';

export interface CouncilSessionMeta {
  id: string;
  slug: string;
  repoPath: string;
  worktreePath: string;
  baseRef: string;
  baseSha: string;
  maxRounds: number;
  signoffRevisions?: number;
  tiebreakRound: number;
  createdAt: string;
  parentSession?: string;
  continuesSession?: string;
  backlogItem?: string;
}

export interface CouncilConfig {
  version: number;
  project: {
    name: string;
    base_branch: string;
    package_manager: string;
    install_command: string;
    test_command: string;
    lint_command: string;
  };
  council: {
    max_rounds: number;
    tiebreak_round: number;
    round_timeout_seconds: number;
    execution_timeout_seconds: number;
    execution_attempts: number;
    /** Extra rounds granted for resolving sign-off concerns after the Chief Engineer has converged. */
    signoff_revisions: number;
  };
  seats: {
    lead_pm: SeatConfig;
    chief_engineer: SeatConfig;
    chief_architect: SeatConfig;
  };
  backlog: {
    wip_limit: number;
    auto_merge_dev: boolean;
  };
  office: {
    port: number;
    auto_open: boolean;
  };
  verification?: {
    gates?: VerificationGate[];
    /** Stop at the first failed required gate instead of collecting every failure. Defaults to false. */
    fail_fast?: boolean;
  };
}

export interface VerificationGate {
  /** Unique, stable name; appears in the evidence report and the pull request body. */
  name: string;
  command: string;
  /** false makes the gate advisory: it is recorded but does not block the pull request. Defaults to true. */
  required?: boolean;
  timeout_seconds?: number;
  /** The standard or checklist point this gate enforces, for the audit trail. */
  standard?: string;
}

export interface GateResult {
  name: string;
  command: string;
  required: boolean;
  standard?: string;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  timedOut?: boolean;
  output: string;
}

export interface SeatConfig {
  provider: 'claude-code' | 'grok-cli' | 'gemini-cli' | 'antigravity' | 'ollama' | string;
  model: string;
  persona: string;
}

export interface BacklogItem {
  id: string;
  slug: string;
  title: string;
  priority: number;
  status: 'todo' | 'in-council' | 'awaiting-approval' | 'in-execution' | 'done' | 'parked' | 'needs-decision';
  kind: string;
  created: string;
  session?: string;
  body: string;
}

export interface AgentOfficeStatus {
  state: 'idle' | 'busy' | 'waiting' | 'blocked';
  detail: string;
}

export interface OfficeState {
  synapse: AgentOfficeStatus;
  claude: AgentOfficeStatus;
  grok: AgentOfficeStatus;
  ticker: { text: string };
  pipeline: {
    activeItem?: { id: string; title: string; status: string };
    items: Array<{ id: string; title: string; status: string; priority: number }>;
  };
}
