export function isThinkingModel(model: string | undefined | null): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  if (lower.includes('deepseek-v4')) return true;
  if (lower.includes('pro')) return true;
  if (lower.includes('thinking')) return true;
  return false;
}
