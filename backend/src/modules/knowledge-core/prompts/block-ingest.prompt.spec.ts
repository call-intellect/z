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

  it('decision имеет явные русские маркеры', () => {
    expect(system).toContain('решили что');
    expect(system).toContain('остановились на');
    expect(system).toContain('договорились делать');
  });

  it('idea имеет явные русские маркеры', () => {
    expect(system).toContain('а что если');
    expect(system).toContain('давайте попробуем');
    expect(system).toContain('предлагаю сделать');
  });

  it('дизамбигуация защищает commitment/plan_item от каннибализации decision', () => {
    // decision-описание явно отделяет себя от commitment/plan_item.
    expect(system).toContain('commitment — обязательство КОНКРЕТНОГО человека');
    expect(system).toContain('plan_item — пункт плана на период');
  });

  it('idea-описание отделяет себя от suggestion/feature_request', () => {
    expect(system).toContain('suggestion — общий совет без новизны');
    expect(system).toContain('feature_request — запрос конкретной фичи');
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
      'Имена людей (поля *NameGuess, recipient, decidedBy и т.п.) бери ТОЛЬКО из реплик/спикеров',
    );
  });
});
