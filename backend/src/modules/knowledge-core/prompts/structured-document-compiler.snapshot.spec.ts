/**
 * Snapshot-тест сборки промта `structured-document-compiler.prompt.ts`
 * (ТЗ 2026-06-16 пачка 8, Прил. E3 — компилятор орг-документа).
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - system (через `buildCompileOrgDocumentSystemPrompt`) — тело E3 +
 *     дописанный в КОНЕЦ `withDocumentCompilerMode` (режимы/маркеры);
 *     режимы/маркеры в теле НЕ дублируются подробно — только краткая ссылка;
 *     SYSTEM cache-friendly — правка ломает prompt-кэш;
 *   - user для типичного входа (kind подан ярлыком, технический kind остаётся
 *     ключом маршрутизации).
 *
 * Обновлять только при осознанном изменении:
 *   bunx vitest run -u src/modules/knowledge-core/prompts/structured-document-compiler.snapshot.spec.ts
 */
import { describe, expect, it } from 'vitest';

import {
  buildCompileOrgDocumentSystemPrompt,
  buildCompileOrgDocumentUserMessage,
} from './structured-document-compiler.prompt';

describe('structured-document-compiler — snapshot сборки промта', () => {
  it('system стабилен (E3-body + document-compiler mode note)', () => {
    expect(buildCompileOrgDocumentSystemPrompt()).toMatchSnapshot('system');
  });

  it('system содержит ключевые инварианты E3 (методист, все 3 маркера, ПРИМЕР с [конфликт], политика «уровень … [требует уточнения]»)', () => {
    const system = buildCompileOrgDocumentSystemPrompt();
    expect(system).toContain('методист корпоративной документации');
    expect(system).toContain('[требует уточнения]');
    expect(system).toContain('[конфликт]');
    expect(system).toContain('[изменено]');
    // Структуры по типам по-русски.
    expect(system).toContain('Описание процесса');
    // Политика — уровень строгости при отсутствии в материале.
    expect(system).toContain(
      'уровень не указан → «[требует уточнения]»',
    );
  });

  it('user для kind=regulation: kind подан ярлыком + технический ключ маршрутизации сохранён', () => {
    const user = buildCompileOrgDocumentUserMessage({
      kind: 'regulation',
      name: 'Согласование договоров',
      newSourceBlocks: [
        {
          name: 'Маршрут договора',
          question: 'Кто проверяет договор перед подписанием?',
          answer: 'Юрист проверяет за 3 дня, затем подписывает руководитель.',
          quotes: ['юрист проверяет договор'],
        },
      ],
      existingContentMd: null,
    });
    expect(user).toContain('Тип документа: Регламент');
    expect(user).toContain('kind: regulation');
    expect(user).toContain('«Регламент»');
    expect(user).toMatchSnapshot('user-regulation');
  });
});
