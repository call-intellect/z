export type Outcome = 'answered' | 'honest_empty' | 'real_fail';

export type OutcomeRec = {
  answerText?: string | null;
  needsClarification?: boolean | null;
};

export type OutcomeGold = {
  expectedKind: 'answerable' | 'honest_empty';
};

const REFUSAL_RE =
  /(не наш[её]л|не нашл[аило]|не найд[а-яё]*|не удалось (най|обнаруж)[а-яё]*|нет данных|нет информации|нет сведени[йя]|данных нет|сведени[йя] нет|информации нет|не располага[а-яё]*|не зафиксирован[а-яё]*|отсутству[а-яё]*\s+(данн|информац|сведени)[а-яё]*|в памяти компании (нет|отсутству[а-яё]*)|(данн|сведени|информац)[а-яё]*\s+об?\s+[^.!?]{0,60}?(?<![а-яё])нет(?![а-яё]))/;

export function isRefusal(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (t.length === 0) return true;
  return REFUSAL_RE.test(t.slice(0, 200).toLowerCase());
}

export function classifyOutcome(
  rec: OutcomeRec,
  gold: OutcomeGold,
  opts?: { refusalOverride?: boolean },
): Outcome {
  const clarifiedOnly = rec.needsClarification === true && (rec.answerText ?? '').trim().length < 40;
  const refusal = opts?.refusalOverride ?? (isRefusal(rec.answerText) || clarifiedOnly);

  if (refusal) {
    return gold.expectedKind === 'honest_empty' ? 'honest_empty' : 'real_fail';
  }
  if (gold.expectedKind === 'honest_empty') {
    return 'real_fail';
  }
  return 'answered';
}

function tokenHit(text: string, token: string): boolean {
  return token
    .split('|')
    .some((alt) => alt.trim().length > 0 && text.includes(alt.trim().toLowerCase()));
}

export function mustMentionCoverage(text: string | null | undefined, mustMention: string[]): number {
  if (mustMention.length === 0) return 1;
  const t = (text ?? '').toLowerCase();
  const hit = mustMention.filter((m) => tokenHit(t, m)).length;
  return hit / mustMention.length;
}

export function missingMustMention(text: string | null | undefined, mustMention: string[]): string[] {
  const t = (text ?? '').toLowerCase();
  return mustMention.filter((m) => !tokenHit(t, m));
}
