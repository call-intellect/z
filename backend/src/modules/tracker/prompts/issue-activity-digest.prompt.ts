export const ISSUE_ACTIVITY_DIGEST_SYSTEM_PROMPT = `# Кто ты
Ты — помощник по задачам в компании «Кора». Человек давно не заходил в задачу и хочет за несколько секунд понять, что по ней изменилось с прошлого захода. По набору фактов об изменениях ты собираешь короткую человеческую сводку «что произошло».

# Что вернуть
3–5 коротких пунктов по-русски о том, что изменилось: смены статуса, исполнителя, срока; закрытые пункты чек-листа; новые комментарии и обновления прогресса. Каждый пункт — одна короткая строка с датой, если она известна.

# Правила
- Опирайся только на присланные факты. Не выдумывай событий, цифр и сроков, которых в них нет.
- Тон — ввод в курс дела, помощь коллеге, а не отчёт начальству. Без официоза, без латиницы, без кодов и идентификаторов.
- Не оценивай людей и не следи за ними — описывай, что произошло с делом, не с сотрудником.
- Без воды и общих фраз. Если факт незначителен — опусти его.
- Верни обычный текст: 3–5 пунктов с маркером «—» в начале строки. Без markdown-заголовков, без emoji, без вступления и заключения.`;

export interface IssueActivityDigestPoint {
  label: string;
  detail: string;
  at: string | null;
}

export interface IssueActivityDigestInput {
  title: string;
  sinceLabel: string | null;
  statusChanges: number;
  assigneeChanges: number;
  dueDateChanges: number;
  checklistDone: number;
  newComments: number;
  newProgressUpdates: number;
  points: IssueActivityDigestPoint[];
}

export function buildIssueActivityDigestUserMessage(input: IssueActivityDigestInput): string {
  return [
    `Задача: «${input.title}».`,
    input.sinceLabel ? `Окно: с ${input.sinceLabel}.` : 'Окно: последние изменения.',
    '',
    'Собери короткую сводку «что произошло по задаче» на основе фактов ниже.',
    '',
    JSON.stringify(
      {
        totals: {
          statusChanges: input.statusChanges,
          assigneeChanges: input.assigneeChanges,
          dueDateChanges: input.dueDateChanges,
          checklistDone: input.checklistDone,
          newComments: input.newComments,
          newProgressUpdates: input.newProgressUpdates,
        },
        events: input.points.map((p) => ({
          what: p.label,
          detail: p.detail,
          at: p.at,
        })),
      },
      null,
      2,
    ),
  ].join('\n');
}
