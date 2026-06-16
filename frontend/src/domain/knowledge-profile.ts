import type {
  KnowledgeProfileApi,
  KnowledgeProfileCategoryApi,
  KnowledgeProfileConfidenceApi,
  KnowledgeProfileHighlightApi,
  KnowledgeProfileSampleStatementApi,
} from "@/api/knowledge-clone.api";

export type KnowledgeProfileConfidence = KnowledgeProfileConfidenceApi;

export const KNOWLEDGE_PROFILE_CONFIDENCE_SHORT: Record<
  KnowledgeProfileConfidence,
  string
> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};

export interface KnowledgeProfileSampleStatement {
  quote: string;
  blockId: string;
  sourceUrl: string | null;
}

export interface KnowledgeProfileCategory {
  name: string;
  confidence: KnowledgeProfileConfidence;
  observationCount: number;
  sampleStatements: KnowledgeProfileSampleStatement[];
  relatedEntityIds: string[];
  lastObservedAt: Date;
}

export interface KnowledgeProfileHighlight {
  summary: string;
  blockIds: string[];
}

export interface KnowledgeProfile {
  personId: string;
  personName: string;
  version: number;
  builtAt: Date | null;
  isEmpty: boolean;
  categories: KnowledgeProfileCategory[];
  experienceHighlights: KnowledgeProfileHighlight[];
  isSelf: boolean;
}

function mapSampleStatement(
  api: KnowledgeProfileSampleStatementApi,
): KnowledgeProfileSampleStatement {
  return {
    quote: api.quote,
    blockId: api.blockId,
    sourceUrl: api.sourceUrl ?? null,
  };
}

function mapCategory(
  api: KnowledgeProfileCategoryApi,
): KnowledgeProfileCategory {
  return {
    name: api.name,
    confidence: api.confidence,
    observationCount: api.observationCount,
    sampleStatements: api.sampleStatements.map(mapSampleStatement),
    relatedEntityIds: api.relatedEntityIds,
    lastObservedAt: new Date(api.lastObservedAt),
  };
}

function mapHighlight(
  api: KnowledgeProfileHighlightApi,
): KnowledgeProfileHighlight {
  return {
    summary: api.summary,
    blockIds: api.blockIds,
  };
}

export function mapKnowledgeProfile(
  api: KnowledgeProfileApi,
): KnowledgeProfile {
  return {
    personId: api.personId,
    personName: api.personName,
    version: api.version,
    builtAt: api.builtAt ? new Date(api.builtAt) : null,
    isEmpty: api.isEmpty,
    categories: api.categories.map(mapCategory),
    experienceHighlights: api.experienceHighlights.map(mapHighlight),
    isSelf: api.isSelf,
  };
}
