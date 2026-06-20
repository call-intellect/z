import type {
  ProvenanceNodeApi,
  ProvenanceResponseApi,
} from "@/api/provenance.api";

export type ProvenanceSourceType =
  | "meeting"
  | "document"
  | "chat"
  | "voice_note"
  | "email"
  | "phone_call";

const SOURCE_TYPES: readonly string[] = [
  "meeting",
  "document",
  "chat",
  "voice_note",
  "email",
  "phone_call",
];

export interface ProvenanceSource {
  type: ProvenanceSourceType;
  refId: string | null;
  label: string;
  deepLink: string | null;
}

export interface ProvenanceRef {
  blockId: string;
  source: ProvenanceSource;
  quote: string;
  attribution: "quoted" | "inferred";
  startMs: number | null;
  endMs: number | null;
  confidence: number | null;
  accessFiltered: boolean;
}

export interface Provenance {
  nodes: ProvenanceRef[];
  coverage: { blocks: number; meetings: number };
}

function toSourceType(t: string): ProvenanceSourceType {
  return SOURCE_TYPES.includes(t) ? (t as ProvenanceSourceType) : "chat";
}

export function mapProvenanceNode(api: ProvenanceNodeApi): ProvenanceRef {
  return {
    blockId: api.blockId,
    source: {
      type: toSourceType(api.source.type),
      refId: api.source.refId,
      label: api.source.label,
      deepLink: api.source.deepLink,
    },
    quote: api.quote,
    attribution: api.attribution,
    startMs: api.startMs,
    endMs: api.endMs,
    confidence: api.confidence,
    accessFiltered: api.accessFiltered,
  };
}

export function mapProvenance(api: ProvenanceResponseApi): Provenance {
  return {
    nodes: (api.nodes ?? []).map(mapProvenanceNode),
    coverage: {
      blocks: api.coverage?.blocks ?? 0,
      meetings: api.coverage?.meetings ?? 0,
    },
  };
}

export function provenanceCoverageLabel(coverage: {
  blocks: number;
  meetings: number;
}): string {
  if (coverage.blocks === 0) return "нет источников";
  const blocksWord = pluralRu(coverage.blocks, ["реплике", "репликам", "репликам"]);
  if (coverage.meetings === 0) return `по ${coverage.blocks} ${blocksWord}`;
  const meetWord = pluralRu(coverage.meetings, ["встречи", "встреч", "встреч"]);
  return `по ${coverage.blocks} ${blocksWord} из ${coverage.meetings} ${meetWord}`;
}

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}
