import { describe, expect, it } from 'vitest';

import { buildBlockIngestPrompt } from './block-ingest.prompt';

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
