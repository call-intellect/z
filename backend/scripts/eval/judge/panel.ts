import OpenAI from 'openai';

export type Lens = 'literal' | 'coverage' | 'honesty';
export type LensVerdict = 'correct' | 'incorrect';
export type Vote = { lens: Lens; verdict: LensVerdict; reason: string };
export type PanelVerdict = { verdict: LensVerdict; agree: number; total: number; votes: Vote[] };

export type LlmCall = (system: string, user: string) => Promise<{ verdict: LensVerdict; reason: string } | null>;

export type JudgeInput = { question: string; answerText: string | null };
export type JudgeGold = {
  expectedAnswer?: string;
  mustMention: string[];
  expectedKind: 'answerable' | 'honest_empty';
};

export const LENS_SYSTEM: Record<Lens, string> = {
  literal:
    'Ты — судья буквального соответствия ответа эталону в памяти компании. Ответ верен, если он не противоречит эталону и отвечает по существу вопроса. Мелкие уточнения из контекста — не ошибка. Верни строго JSON {"verdict":"correct"|"incorrect","reason":"кратко"}.',
  coverage:
    'Ты — судья полноты охвата. Ответ верен, если покрывает ключевые факты эталона (mustMention). Пропуск существенного факта → incorrect. Верни строго JSON {"verdict":"correct"|"incorrect","reason":"кратко"}.',
  honesty:
    'Ты — судья честности против выдумок. Для answerable: ответ НЕ должен выдумывать фактов сверх эталона. Для honest_empty: система ДОЛЖНА честно признать отсутствие данных, а НЕ придумать ответ. Верни строго JSON {"verdict":"correct"|"incorrect","reason":"кратко"}.',
};

export function buildUser(input: JudgeInput, gold: JudgeGold): string {
  const parts = [
    `Вопрос: ${input.question}`,
    `Ожидаемый тип ответа: ${gold.expectedKind}`,
    gold.expectedAnswer ? `Эталон: ${gold.expectedAnswer}` : '',
    gold.mustMention.length ? `Ключевые факты (mustMention): ${gold.mustMention.join(' · ')}` : '',
    `Ответ системы: ${input.answerText ?? '(пусто)'}`,
    'Оцени ответ. Верни строго JSON.',
  ];
  return parts.filter((p) => p.length > 0).join('\n');
}

export function aggregateVotes(votes: Vote[]): PanelVerdict {
  const total = votes.length;
  const correct = votes.filter((v) => v.verdict === 'correct').length;
  const verdict: LensVerdict = total > 0 && correct > total / 2 ? 'correct' : 'incorrect';
  return { verdict, agree: Math.max(correct, total - correct), total, votes };
}

export async function judgeOne(input: JudgeInput, gold: JudgeGold, call: LlmCall): Promise<PanelVerdict> {
  const lenses: Lens[] = ['literal', 'coverage', 'honesty'];
  const votes = await Promise.all(
    lenses.map(async (lens): Promise<Vote> => {
      const r = await call(LENS_SYSTEM[lens], buildUser(input, gold));
      return r ? { lens, verdict: r.verdict, reason: r.reason } : { lens, verdict: 'incorrect', reason: 'llm-null' };
    }),
  );
  return aggregateVotes(votes);
}

export function parseVerdict(raw: string | undefined): LensVerdict {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('incorrect') || s.includes('неверн') || s.includes('не верн')) return 'incorrect';
  if (s.includes('correct') || s.includes('верн')) return 'correct';
  return 'incorrect';
}

export function makeLlmCall(): LlmCall {
  const client = new OpenAI({
    baseURL: process.env['DEEPSEEK_BASE_URL'] ?? '',
    apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
  });
  const model = process.env['DEEPSEEK_DEFAULT_MODEL'] ?? 'deepseek-v4-flash';
  return async (system, user) => {
    try {
      const r = await client.chat.completions.create({
        model,
        stream: false,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${user}\nВерни строго JSON: {"verdict":"correct|incorrect","reason":"..."}` },
        ],
      });
      const txt = r.choices?.[0]?.message?.content ?? '';
      const j = JSON.parse(txt) as { verdict?: string; reason?: string };
      return { verdict: parseVerdict(j.verdict), reason: typeof j.reason === 'string' ? j.reason : '' };
    } catch {
      return null;
    }
  };
}
