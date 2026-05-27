/**
 * Snapshot-тесты pure-функции `composeUserMessageForIteration` из
 * concierge.service.ts.
 *
 * Фиксируем формат сборки user-блока для одной итерации tool-loop в 4
 * комбинациях входных данных:
 *   (а) no summary, no history, no toolMessages;
 *   (б) summary='Юзер обсуждал миграцию X', no history, no toolMessages;
 *   (в) summary=null, history=2 сообщения, toolMessages=1;
 *   (г) summary='Юзер...', history=2 сообщения, toolMessages=1.
 *
 * Обновлять snapshot'ы только при осознанном изменении формата:
 * `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import { composeUserMessageForIteration } from './concierge.service';

describe('composeUserMessageForIteration', () => {
  it('(а) только userMessage — без summary, history, toolMessages', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Сколько у меня встреч на завтра?',
      toolMessages: [],
      history: [],
      summary: null,
    });
    expect(out).toMatchInlineSnapshot(
      `"Новый запрос пользователя: Сколько у меня встреч на завтра?"`,
    );
  });

  it('(б) summary без history и toolMessages — summary идёт первым блоком', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Продолжаем — что дальше?',
      toolMessages: [],
      history: [],
      summary: 'Юзер обсуждал миграцию X',
    });
    expect(out).toMatchInlineSnapshot(`
      "КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:
      Юзер обсуждал миграцию X

      Новый запрос пользователя: Продолжаем — что дальше?"
    `);
  });

  it('(в) history=2 + toolMessages=1, summary=null — без summary-блока', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Какой статус у задачи №42?',
      toolMessages: [
        {
          role: 'tool',
          content: 'Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}',
        },
      ],
      history: [
        { role: 'user', content: 'Покажи мои задачи' },
        { role: 'assistant', content: 'У вас 3 задачи: №42, №43, №44' },
      ],
      summary: null,
    });
    expect(out).toMatchInlineSnapshot(`
      "История диалога:
      [Пользователь] Покажи мои задачи
      [Ассистент] У вас 3 задачи: №42, №43, №44

      Результаты последних tool вызовов:
      - Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}

      Новый запрос пользователя: Какой статус у задачи №42?"
    `);
  });

  it('(г) summary + history=2 + toolMessages=1 — все три блока по порядку', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Какой статус у задачи №42?',
      toolMessages: [
        {
          role: 'tool',
          content: 'Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}',
        },
      ],
      history: [
        { role: 'user', content: 'Покажи мои задачи' },
        { role: 'assistant', content: 'У вас 3 задачи: №42, №43, №44' },
      ],
      summary: 'Юзер ранее уточнял состояние задач Q1',
    });
    expect(out).toMatchInlineSnapshot(`
      "КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:
      Юзер ранее уточнял состояние задач Q1

      История диалога:
      [Пользователь] Покажи мои задачи
      [Ассистент] У вас 3 задачи: №42, №43, №44

      Результаты последних tool вызовов:
      - Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}

      Новый запрос пользователя: Какой статус у задачи №42?"
    `);
  });
});
