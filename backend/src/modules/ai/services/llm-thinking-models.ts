export function isThinkingModel(model: string | undefined | null): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  if (lower.includes('pro')) return true;
  if (lower.includes('thinking')) return true;
  return false;
}

export type LlmThinkingGuardKind = 'strict-stripped' | 'schema-to-tool' | 'tool-choice-relaxed';
