import type {
  KnowledgeSearchResponseApi,
  KnowledgeSearchResultItemApi,
} from "@/api/knowledge-search.api";

export type KnowledgeSearchEvidence = {
  quote: string;
  sourceLabel: string;
  startMs: number | null;
  endMs: number | null;
};

export type KnowledgeSearchResult = {
  id: string;
  title: string;
  answer: string;
  signalType: string;
  signalLabel: string;
  confidence: number;
  evidence: KnowledgeSearchEvidence | null;
  combinedScore: number;
};

export type KnowledgeSearchResults = {
  items: KnowledgeSearchResult[];
  tookMs: number;
};

const SIGNAL_TYPE_LABELS_RU: Record<string, string> = {
  fact: "факт",
  pain: "проблема",
  feature_request: "запрос фичи",
  objection: "возражение",
  churn_risk: "риск оттока",
  idea: "идея",
  risk: "риск",
  commitment: "обязательство",
  decision: "решение",
  mood: "настрой",
  drift: "отклонение",
  competitor_move: "ход конкурента",
  metric_change: "изменение метрики",
  knowledge_gap: "пробел в знаниях",
  reasoning: "рассуждение",
  rationale: "обоснование",
  decision_basis: "основание решения",
  regulation: "регламент",
  process_step: "шаг процесса",
};

const SOURCE_TYPE_LABELS_RU: Record<string, string> = {
  meeting: "встреча",
  bot: "Telegram-бот",
  phone_call: "звонок",
  email: "почта",
  web_form: "дамп мысли",
  chat: "переписка",
  document: "документ",
};

export function signalTypeLabelRu(signalType: string): string {
  return SIGNAL_TYPE_LABELS_RU[signalType] ?? signalType.replace(/_/g, " ");
}

export function sourceTypeLabelRu(sourceType: string): string {
  return SOURCE_TYPE_LABELS_RU[sourceType] ?? sourceType.replace(/_/g, " ");
}

function mapEvidence(
  ev: KnowledgeSearchResultItemApi["evidence"][number] | undefined,
): KnowledgeSearchEvidence | null {
  if (!ev || !ev.quote.trim()) return null;
  return {
    quote: ev.quote.trim(),
    sourceLabel: sourceTypeLabelRu(ev.sourceType),
    startMs: ev.startMs,
    endMs: ev.endMs,
  };
}

export function knowledgeSearchResultFromApi(
  item: KnowledgeSearchResultItemApi,
): KnowledgeSearchResult {
  const { block, evidence, scores } = item;
  const firstEvidence = mapEvidence(evidence[0]);
  const title =
    block.name.trim() || block.criticalQuestion.trim() || "Без названия";
  const answer =
    block.trustedAnswer.trim() ||
    firstEvidence?.quote ||
    block.criticalQuestion.trim() ||
    "";
  return {
    id: block.id,
    title,
    answer,
    signalType: block.signalType,
    signalLabel: signalTypeLabelRu(block.signalType),
    confidence: block.confidence,
    evidence: firstEvidence,
    combinedScore: scores.combined,
  };
}

export function knowledgeSearchResultsFromApi(
  api: KnowledgeSearchResponseApi,
): KnowledgeSearchResults {
  return {
    items: api.results.map(knowledgeSearchResultFromApi),
    tookMs: api.tookMs,
  };
}
