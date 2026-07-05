export type CloneKey = 'ceo' | 'integrator' | 'marketer' | 'support';

export type AskKind = 'role' | 'person' | 'all_formers' | 'frozen_v1';

export type Verdict =
  | 'BOUNDARY_OK'
  | 'BOUNDARY_FAIL'
  | 'FABRICATED'
  | 'REFUSED'
  | 'EXPERT_PASS'
  | 'WEAK';

export interface BankQuestion {
  id: string;
  category: string;
  clone: CloneKey;
  question: string;
  expectedBehavior: string;
  expectedLayer: string[];
  expectedIntent: string;
  groundTruth: string | null;
  forbidden: string | null;
  prediction: { baseline: string; target: string };
  targeted: boolean;
  trap: string | null;
  controlPair: string | null;
  variant: string | null;
  chain: string | null;
  turn: number | null;
  cloneScopeOverride?: 'person';
  askVersion?: 'frozen_v1' | 'all_formers';
}

export interface RunTrace {
  usedBlockIds: string[];
  usedSkillIds: string[];
  usedRegulationNames: string[];
  topicMatchedBlocks: number | null;
  reasoningMode: 'factual' | 'judgmental' | null;
  personaVersion: number | null;
}

export interface DetAsserts {
  citationCount: number;
  citationsValid: boolean;
  hasDisclaimer: boolean;
  firstPerson: boolean;
  layerHit: boolean;
  layerAdvisoryOnly: boolean;
  layerDetail: string;
}

export interface RunResult {
  id: string;
  clone: CloneKey;
  category: string;
  askKind: AskKind;
  question: string;
  conversationId: string | null;
  messageId: string | null;
  text: string;
  refused: boolean;
  refusalReason: string | null;
  errorCode: string | null;
  latencyMs: number;
  citations: string[];
  retrievedTexts: string[];
  trace: RunTrace;
  det: DetAsserts;
}

export interface LensEP {
  expertness: number;
  personaClean: boolean;
  rationale: string;
}

export interface LensM {
  methodFidelity: number;
  rationale: string;
}

export interface LensG {
  fabricated: boolean;
  fabricatedClaim: string;
  rationale: string;
}

export interface LensBoundary {
  boundaryHeld: boolean;
  remainedUseful: boolean;
  rationale: string;
}

export interface Axes {
  E: number;
  M: number;
  G: number;
  L: number;
  P: number;
}

export interface JudgedResult {
  run: RunResult;
  axes: Axes;
  lensEP: LensEP | null;
  lensM: LensM | null;
  lensG: LensG | null;
  lensBoundary: LensBoundary | null;
  boundaryOk: boolean | null;
  verdict: Verdict;
  diagnosis: string | null;
  layer: 'layer0' | 'layer23' | null;
}

export const ADVISORY_LAYERS = new Set(['company_context', 'none']);

export const ANSWERABLE_EXCLUDED_CATEGORIES = new Set(['boundary', 'off_domain']);
