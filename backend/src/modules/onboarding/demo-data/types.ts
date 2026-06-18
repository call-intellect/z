import type { PrismaClient } from '@prisma/client';

export interface SeedContext {
  prisma: PrismaClient;
  tenantId: string;
  ownerUserId: string;
}

export interface IdMap {
  departments: Record<string, string>;
  roles: Record<string, string>;
  persons: Record<string, string>;

  projects: Record<string, string>;
  boards: Record<string, string>;
  states: Record<string, string>;
  cycles: Record<string, string>;
  labels: Record<string, string>;
  issues: Record<string, string>;

  meetings: Record<string, string>;

  ideaBlocks: Record<string, string>;
  entities: Record<string, string>;
  themes: Record<string, string>;

  goals: Record<string, string>;
  skillProfiles: Record<string, string>;

  cards: Record<string, string>;
  processes: Record<string, string>;

  users: Record<string, string>;
  processTemplates: Record<string, string>;
  regulations: Record<string, string>;
  ideas: Record<string, string>;
  ideaClusters: Record<string, string>;
  events: Record<string, string>;
  documents: Record<string, string>;
  referralLinkId: string | null;
  referrals: Record<string, string>;
  feedbackMessages: Record<string, string>;
  feedbackTopics: Record<string, string>;
  experiments: Record<string, string>;
  vendors: Record<string, string>;
  probeEvents: Record<string, string>;

  pulseSnapshotIds: {
    knowledgeRisks: string[];
    recurringTopics: string[];
    personGoalContributions: string[];
    promiseNetwork: string | null;
    knowledgeVelocity: string | null;
    personEngagements: string[];
    forecasts: string[];
    frictionReports: string[];
    helpfulnessTraits: string[];
    helpfulnessSpotlights: string[];
    socialContributions: string[];
    contributions: string[];
  };
}

export function createEmptyIdMap(): IdMap {
  return {
    departments: {},
    roles: {},
    persons: {},
    projects: {},
    boards: {},
    states: {},
    cycles: {},
    labels: {},
    issues: {},
    meetings: {},
    ideaBlocks: {},
    entities: {},
    themes: {},
    goals: {},
    skillProfiles: {},
    cards: {},
    processes: {},
    users: {},
    processTemplates: {},
    regulations: {},
    ideas: {},
    ideaClusters: {},
    events: {},
    documents: {},
    referralLinkId: null,
    referrals: {},
    feedbackMessages: {},
    feedbackTopics: {},
    experiments: {},
    vendors: {},
    probeEvents: {},
    pulseSnapshotIds: {
      knowledgeRisks: [],
      recurringTopics: [],
      personGoalContributions: [],
      promiseNetwork: null,
      knowledgeVelocity: null,
      personEngagements: [],
      forecasts: [],
      frictionReports: [],
      helpfulnessTraits: [],
      helpfulnessSpotlights: [],
      socialContributions: [],
      contributions: [],
    },
  };
}

export type SeedFn = (ctx: SeedContext, ids: IdMap) => Promise<void>;

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d;
}

export function at(dateStr: string, hours = 10): Date {
  const d = new Date(dateStr);
  d.setHours(hours, 0, 0, 0);
  return d;
}

export function localDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function demoId(prefix: string, n: number): string {
  return `demo-${prefix}-${String(n).padStart(4, '0')}`;
}

export function req(val: string | undefined, label: string): string {
  if (!val) throw new Error(`Demo seed: missing required id "${label}"`);
  return val;
}

export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
