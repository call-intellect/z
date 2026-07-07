export interface A5Block {
  order: number;
  signalType: string;
  name: string;
  criticalQuestion?: string;
  trustedAnswer: string;
  evidenceQuotes?: string[];
  tags: string[];
  solverPerson: string | null;
  coSolvers?: string[] | null;
}

export interface A5RequiresIssue {
  title: string;
  assignee: string;
  trivial?: boolean;
}

export interface A5Scenario {
  id: string;
  cell: string;
  channel: string;
  trap: boolean;
  agentFocus: string;
  requiresIssue: A5RequiresIssue | null;
  requiresPersons: string[];
  blocks: A5Block[];
}

export interface A5Ruler {
  created: boolean;
  owner?: string;
  subjectPersons?: string[];
  sourceIssueLinked?: boolean;
  solutionGist?: string;
  cloneAlsoFed?: boolean;
  builtFrom?: string;
  count?: number;
  mustNotOwn?: string[];
  repeatCandidateInstruction?: boolean;
  contentMustPreserve?: string[];
  contentMustContain?: string[];
  note?: string;
}

export interface A5Case {
  scenario: A5Scenario;
  ruler: A5Ruler;
}

export interface RegStandManifest {
  orgId: string;
  ownerUserId: string;
  projectId: string;
  defaultStateId: string | null;
  people: Record<string, string>;
  personIds: Record<string, string>;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface BuildPassStats {
  candidates: number;
  created: number;
  updated: number;
  skippedNoOwner: number;
  skippedGate: number;
  skippedNoNew: number;
}

export interface ObservedTaskSolution {
  id: string;
  title: string;
  ownerPersonId: string;
  ownerPersonName: string | null;
  personSubjectIds: string[];
  subjectPersonNames: string[];
  sourceIssueId: string;
  sourceBlockIds: string[];
  skillTags: string[];
  solutionMd: string;
  repeatGroupKey: string | null;
  candidateInstruction: boolean;
  version: number;
  hasEmbedding: boolean;
}

export interface ScenarioObservation {
  scenarioId: string;
  cell: string;
  trap: boolean;
  issueId: string | null;
  assignee: string | null;
  solution: ObservedTaskSolution | null;
  solutionCountForIssue: number;
  sourceBlockIds: string[];
  sourceBlocksStillCanonical: boolean;
}

export interface RawRun {
  stamp: string;
  orgId: string;
  headCommit: string;
  createdAt: string;
  passStats: {
    create: BuildPassStats;
    extend: BuildPassStats;
    idempotency: BuildPassStats;
  };
  embeddingsWritten: number;
  observations: ScenarioObservation[];
  config: Record<string, unknown>;
}

export type A5Verdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'N/A';

export interface A5MetricCheck {
  metric: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
  na?: boolean;
  note?: string;
}

export interface A5Match {
  scenarioId: string;
  cell: string;
  trap: boolean;
  keyMetric: string;
  checks: A5MetricCheck[];
  verdict: A5Verdict;
  attribution: string;
  diagnosis: string;
}

export interface JudgeVote {
  judge: string;
  gistCaptured: boolean;
  ownerCorrect: boolean;
  subjectsCorrect: boolean;
  verdict: 'good' | 'flawed' | 'wrong';
  rationale: string;
  error?: string | null;
}

export interface JudgedScenario {
  scenarioId: string;
  votes: JudgeVote[];
  majorityGist: boolean;
  majorityOwner: boolean;
  consensus: 'good' | 'flawed' | 'wrong' | 'no-quorum';
}
