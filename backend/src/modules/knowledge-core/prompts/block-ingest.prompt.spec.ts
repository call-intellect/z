import { describe, expect, it } from 'vitest';

import { buildBlockIngestPrompt } from './block-ingest.prompt';
import type { Segment } from '../services/segment-builder.service';

/**
 * Ф1 agent-chain-overhaul (2026-06-07) — recall классификации signalType.
 *
 * Корень «Решения=0/Идеи=0» (доказан мастер-доком): block-ingest LLM не
 * классифицирует блоки как decision/idea, т.к. их описания в SYSTEM были
 * «тонкими» (без «Маркеры:»), в отличие от ~30 других типов. Мы добавили
 * явные русские триггеры + дизамбигуацию (decision≠commitment/plan_item,
 * idea≠suggestion/feature_request), чтобы поднять recall, НЕ каннибализируя
 * commitment/plan_item (из них рождаются Цели).
 *
 * Этот тест — детерминированный регресс-гард: маркеры присутствуют, а
 * дизамбигуация защищает commitment/plan_item. Полная golden-верификация
 * (recall до/после + что Goals не упали) требует живого backend+LLM (НЕ прод)
 * — фикстура growth-funnel готова, прогон отложен на dev (см. ТЗ §Ф1).
 */
describe('block-ingest prompt — signalType recall (Ф1)', () => {
  const { system } = buildBlockIngestPrompt({ segments: [] });

  // ТЗ 2026-06-16 (Прил. A1) — SYSTEM переписан по методологии (7 блоков).
  // Различение классов перенесено в блок «Главные различия классов» с
  // примерами-маркерами, дублируемыми в few-shot. Ассерты обновлены под него.
  it('decision имеет явный маркер-различие', () => {
    expect(system).toContain('решили остановиться на варианте Б');
  });

  it('idea имеет явный маркер-различие', () => {
    expect(system).toContain('а давайте попробуем Б');
  });

  it('дизамбигуация защищает commitment/plan_item от каннибализации decision', () => {
    // Решение явно отделено от обязательства и пункта плана.
    expect(system).toContain('Обязательство — кто-то лично обещает сделать');
    expect(system).toContain('и не пункт плана');
  });

  it('idea-описание отделяет себя от suggestion/feature_request', () => {
    expect(system).toContain('Совет (suggestion) — общая рекомендация без новизны');
    expect(system).toContain('Запрос фичи (feature_request) — просьба сделать конкретную функцию');
  });

  // Маркеры методологии (acceptance Ф1) — блок различий, self-check, запрет кодов.
  it('содержит блок различий классов, самопроверку и запрет кодов', () => {
    expect(system).toContain('Главные различия классов');
    expect(system).toContain('самопроверка');
    expect(system).toContain('Чистый русский на выходе');
  });

  // C1 agent-chain-overhaul (2026-06-07) — ASR-нота применена ко ВСЕМ
  // извлекающим промптам (включая block-ingest), чтобы модель восстанавливала
  // искажённые ASR числа/имена/термины по контексту.
  it('содержит ASR-ноту (withAsrNote)', () => {
    expect(system).toContain('автоматического распознавания речи');
  });

  // C6 agent-chain-overhaul — анти-галлюцинация имён: имена людей берём ТОЛЬКО
  // из реплик/спикеров; если имя не звучало — null, не выдумываем.
  it('содержит правило анти-галлюцинации имён (C6)', () => {
    expect(system).toContain(
      'бери ТОЛЬКО из реплик и из имён спикеров',
    );
  });
});

describe('buildBlockIngestPrompt — контекст эпизода (Ф3 A)', () => {
  const segments: Segment[] = [
    { startMs: 0, endMs: 1000, speakers: ['Анна'], text: 'Я подготовлю смету к пятнице.' },
  ];

  it('включает дату (ДД.ММ.ГГГГ), тип, участников и заголовок в user', () => {
    const { user } = buildBlockIngestPrompt({
      meetingTitle: 'Планёрка отдела продаж',
      meetingDateIso: '2026-03-07T12:34:56.000Z',
      meetingType: 'sales',
      participants: ['Анна', 'Борис'],
      segments,
    });

    expect(user).toContain('Контекст эпизода:');
    expect(user).toContain('07.03.2026');
    expect(user).toContain('Планёрка отдела продаж');
    expect(user).toContain('sales');
    expect(user).toContain('Анна, Борис');
  });

  it('SYSTEM не зависит от user-аргументов (prompt-cache сохранён)', () => {
    const withContext = buildBlockIngestPrompt({
      meetingTitle: 'Планёрка',
      meetingDateIso: '2026-03-07T12:00:00.000Z',
      meetingType: 'sales',
      participants: ['Анна', 'Борис'],
      segments,
    });
    const without = buildBlockIngestPrompt({ segments });

    expect(withContext.system).toBe(without.system);
  });

  it('пустой контекст не печатает шапку', () => {
    const { user } = buildBlockIngestPrompt({ segments });
    expect(user).not.toContain('Контекст эпизода:');
    expect(user.startsWith('Сегменты')).toBe(true);
  });

  it('SYSTEM содержит инвариант многостороннего факта (R13) и пункт 10 самопроверки', () => {
    const { system } = buildBlockIngestPrompt({ segments });
    expect(system).toContain('Многосторонний факт');
    expect(system).toContain(
      '10. Многосторонние обязательства/договорённости не схлопнуты',
    );
  });
});
