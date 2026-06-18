/**
 * Snapshot-тест сборки промта `role-profile-build.prompt.ts`
 * (ТЗ 2026-06-16 пачка 8, Прил. E1 — карта должности).
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - system (через `buildRoleProfilePrompt`) — тело E1, обёрнутое
 *     `withPeopleHypothesisGuard` (оценка роли = гипотеза, не диагноз);
 *     SYSTEM cache-friendly — правка ломает prompt-кэш;
 *   - user для типичного входа (декларация + наблюдаемые блоки/решения),
 *     где `signalType` подаётся человеческим ярлыком, а не машинным кодом.
 *
 * Обновлять только при осознанном изменении:
 *   bunx vitest run -u src/modules/knowledge-core/prompts/role-profile-build.snapshot.spec.ts
 */
import { describe, expect, it } from 'vitest';

import { buildRoleProfilePrompt } from './role-profile-build.prompt';

const CTX = {
  role: { id: 'role-1', name: 'Маркетолог', departmentName: 'Маркетинг' },
  jobDescriptionMd: 'Ведёт рассылки и сводит отчёт по лидам из CRM.',
  persons: [{ id: 'p1', name: 'Иван' }],
  ideaBlocks: [
    {
      id: '7b2f0000-0000-0000-0000-000000000001',
      text: 'Еженедельно сводит отчёт по лидам из CRM и рассылает в продажи',
      signalType: 'feature_request',
      sourceMeetingTitle: 'Планёрка маркетинга',
      createdAt: '2026-04-05T10:00:00.000Z',
    },
  ],
  themes: [{ id: 't1', name: 'Лиды', description: 'Поток лидов и отчётность' }],
  processes: [{ id: 'pr1', name: 'Еженедельный отчёт по лидам', description: null }],
  decisions: [
    {
      id: 'a1d00000-0000-0000-0000-000000000002',
      text: 'Скидку выше 15% согласует руководитель',
      rationale: 'контроль маржи',
      decidedAt: '2026-04-10T09:00:00.000Z',
    },
  ],
};

describe('role-profile-build — snapshot сборки промта', () => {
  it('system стабилен (E1-body + people-hypothesis guard)', () => {
    const { system } = buildRoleProfilePrompt(CTX);
    expect(system).toMatchSnapshot('system');
  });

  it('system содержит ключевые инварианты E1 (аналитик-кадровик, самопроверка, id ЦЕЛИКОМ, обязательные deprecated-поля)', () => {
    const { system } = buildRoleProfilePrompt(CTX);
    expect(system).toContain('аналитик-кадровик');
    expect(system).toContain('самопроверка');
    expect(system).toContain('id ЦЕЛИКОМ');
    expect(system).toContain('skills, decision_patterns, common_pitfalls');
    // people-hypothesis guard дописан в конец.
    expect(system).toContain('ГИПОТЕЗА');
  });

  it('system перечисляет мэппинг 5 enum дословно', () => {
    const { system } = buildRoleProfilePrompt(CTX);
    expect(system).toContain('результат = outcome · область работы = function · действие = activity');
    expect(system).toContain('можно сам = allowed · нужно согласование = requires_approval · нельзя = forbidden');
    expect(system).toContain('обязательно = mandatory · желательно = preferred · плюсом = nice_to_have');
    expect(system).toContain('начальный = beginner · средний = intermediate · экспертный = expert · неизвестно = null');
    expect(system).toContain('начальный = junior · средний = middle · сильный = senior · экспертный = expert');
  });

  it('user стабилен; signalType подан ярлыком, не машинным кодом', () => {
    const { user } = buildRoleProfilePrompt(CTX);
    expect(user).toContain('[запрос новой возможности]');
    expect(user).not.toContain('[feature_request]');
    expect(user).toMatchSnapshot('user');
  });
});
