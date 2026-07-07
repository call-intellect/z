export interface RunOpts {
  limit?: number;
  ids?: string[];
  cats?: string[];
  stamp: string;
}

export interface ScenarioExpect {
  creates: string;
  count: number;
  fields?: Record<string, unknown>;
  notes?: string;
  targets: string[];
  category: string;
  channel: string;
}

export interface StandManifestProject {
  id: string;
  identifier: string;
  states: Record<string, string>;
}

export interface StandManifestSetupTask {
  issueId: string;
  title: string;
  assigneeUserId: string | null;
  stateCategory: string;
  closed: boolean;
  embeddingReady: boolean;
  tenant: 'A' | 'B';
}

export interface StandManifest {
  orgA: string;
  orgB: string;
  ownerUserIdA: string;
  ownerUserIdB: string;
  people: Record<string, string>;
  projects: Record<string, StandManifestProject>;
  setupTasks: Record<string, StandManifestSetupTask>;
  scenarios: Record<string, ScenarioExpect>;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface ObservedIntakeIssue {
  id: string;
  source: string;
  status: string;
  extractedTitle: string | null;
  extractedDescription: string | null;
  rawContent: string;
  previewQuote: string | null;
  suggestedProjectId: string | null;
  suggestedAssigneeId: string | null;
  suggestedPriority: string | null;
  suggestedDueDate: string | null;
  suggestedGoalId: string | null;
  suggestedDuplicateOfIssueId: string | null;
  checklistJson: unknown;
  sourceBlockIds: string[];
  confidence: number | null;
  meetingId: string | null;
}

export interface ObservedIssue {
  id: string;
  title: string;
  descriptionStripped: string | null;
  previewQuote: string | null;
  parentId: string | null;
  stateCategory: string | null;
  assigneeUserIds: string[];
  priority: string;
  dueDate: string | null;
  checklistTotalCount: number;
  completedAt: string | null;
  createdManually: boolean;
  sourceBlockIds: string[];
  goalId: string | null;
  linkedMeetingIds: string[];
}

export interface ObservedClosureCandidate {
  id: string;
  issueId: string;
  status: string;
  matchSimilarity: number | null;
  rationale: string | null;
  evidenceQuote: string | null;
}

export interface ObservedProgressUpdate {
  id: string;
  issueId: string;
  authorType: string;
  health: string;
  draftState: string | null;
  doneText: string | null;
  nextText: string | null;
  body: string;
}

export interface ObservedRelation {
  issueId: string;
  relatedIssueId: string;
  relationType: string;
}

export interface ObservedProbeEvent {
  id: string;
  reason: string;
}

export interface ObservedIdeaBlock {
  id: string;
  signalType: string;
}

export interface ObservedGoal {
  id: string;
  title: string;
}

export interface ObservedError {
  code: string;
  message: string;
}

export interface RawObservationInjected {
  method: string;
  meetingId?: string;
  rawEventIds?: string[];
  directIssueId?: string;
  harnessApplied?: boolean;
  quiescenceSettled?: boolean;
  quiescenceWaitedMs?: number;
}

export interface RawObservationObserved {
  intakeIssues: ObservedIntakeIssue[];
  issues: ObservedIssue[];
  closureCandidates: ObservedClosureCandidate[];
  progressUpdates: ObservedProgressUpdate[];
  relations: ObservedRelation[];
  probeEvents: ObservedProbeEvent[];
  ideaBlocks: ObservedIdeaBlock[];
  goals: ObservedGoal[];
  errors: ObservedError[];
}

export interface RawObservationT1 {
  blockId?: string;
  combinedProducedIntake: boolean;
  combinedIntakeSource?: string | null;
  legacyProcessBlockOutput?: unknown;
  legacyExtractTasksOutput?: unknown;
}

export interface RawObservation {
  scenarioId: string;
  category: string;
  channel: string;
  targets: string[];
  submittedAt: string;
  headCommit: string;
  injected: RawObservationInjected;
  observed: RawObservationObserved;
  t1Isolation?: RawObservationT1;
}

export interface AssertResult {
  scenarioId: string;
  outcomeType: string;
  count: number;
  fieldChecks: Record<string, boolean | string>;
  invariants: { inv1: boolean; inv2: boolean; inv4: boolean };
  verdict: 'PASS' | 'PARTIAL' | 'WRONG_OUTCOME' | 'INVARIANT_FAIL' | 'PENDING_JUDGE';
}

export interface JudgedResult {
  scenarioId: string;
  lensForm?: unknown;
  lensFields?: unknown;
  lensOutcome?: unknown;
  axisT?: number;
  verdict: string;
}
