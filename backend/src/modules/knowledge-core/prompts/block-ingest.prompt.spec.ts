import { describe, expect, it } from 'vitest';

import { buildBlockIngestPrompt } from './block-ingest.prompt';

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
    expect(system).toContain('commitment — обязательство КОНКРЕТНОГО человека');
    expect(system).toContain('plan_item — пункт плана на период');
  });

  it('idea-описание отделяет себя от suggestion/feature_request', () => {
    expect(system).toContain('suggestion — общий совет без новизны');
    expect(system).toContain('feature_request — запрос конкретной фичи');
  });

  it('содержит ASR-ноту (withAsrNote)', () => {
    expect(system).toContain('автоматического распознавания речи');
  });

  it('содержит правило анти-галлюцинации имён (C6)', () => {
    expect(system).toContain(
      'Имена людей (поля *NameGuess, recipient, decidedBy и т.п.) бери ТОЛЬКО из реплик/спикеров',
    );
  });
});
