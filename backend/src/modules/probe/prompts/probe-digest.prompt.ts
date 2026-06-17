export interface ProbeDigestItem {
  question: string;
  objectTitle?: string;
  probeEventId: string;
}

function pluralizeVopros(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return 'вопросов';
  if (last === 1) return 'вопрос';
  if (last >= 2 && last <= 4) return 'вопроса';
  return 'вопросов';
}

export function buildProbeDigestSummary(items: readonly ProbeDigestItem[]): string {
  if (items.length === 0) return 'Кора пока без вопросов.';
  const head =
    items.length === 1
      ? 'Кора просит уточнить один момент:'
      : `Кора собрала ${items.length} ${pluralizeVopros(items.length)} — ответьте, когда будет минута:`;
  const lines = items.map((it, i) => {
    const obj = it.objectTitle ? ` (${it.objectTitle})` : '';
    return `${i + 1}. ${it.question}${obj}`;
  });
  return `${head}\n${lines.join('\n')}`;
}
