/**
 * Unit-тесты `buildEntityGroups` — трансформации RAW-секций
 * `extractedEntities` (контракт backend) в UI-модель `entityGroups[]`.
 *
 * Контекст: backend `GET /api/v1/documents/:id` возвращает извлечённые
 * карточки как именованные секции (`processes` / `decisions` / …), а UI
 * потребляет `entityGroups[]`. Без этой трансформации `DocumentDetailClient`
 * читал `undefined.length` и крашился (pre-existing баг).
 *
 * Проверяется:
 *  (1) decisions → группа `decision`, item.name берётся из `text`,
 *      trustTier пробрасывается.
 *  (2) metrics → группа `metric`, item.trustTier === undefined.
 *  (3) пустые секции НЕ дают группу (а непустые — дают).
 *  (4) `undefined` на входе → `[]`.
 */
import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  buildEntityGroups,
  documentKindLabel,
  documentTypeLabel,
} from './documents.api';

function emptyRaw() {
  return {
    processes: [],
    decisions: [],
    regulations: [],
    policies: [],
    metrics: [],
    tools: [],
  };
}

describe('buildEntityGroups', () => {
  it('decisions: name берётся из text, trustTier пробрасывается', () => {
    const groups = buildEntityGroups({
      ...emptyRaw(),
      decisions: [
        { id: 'd1', text: 'Внедрить OKR', confidence: 0.8, trustTier: 'provisional' },
      ],
    });

    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.kind).toBe('decision');
    expect(group.total).toBe(1);
    expect(group.items).toHaveLength(1);
    expect(group.items[0]).toEqual({
      id: 'd1',
      kind: 'decision',
      name: 'Внедрить OKR',
      confidence: 0.8,
      trustTier: 'provisional',
    });
  });

  it('metrics: группа metric, item.trustTier === undefined', () => {
    const groups = buildEntityGroups({
      ...emptyRaw(),
      metrics: [{ id: 'm1', name: 'NPS', confidence: 0.5 }],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('metric');
    expect(groups[0].items[0].trustTier).toBeUndefined();
    expect(groups[0].items[0]).toEqual({
      id: 'm1',
      kind: 'metric',
      name: 'NPS',
      confidence: 0.5,
    });
  });

  it('confidence === null → 0', () => {
    const groups = buildEntityGroups({
      ...emptyRaw(),
      processes: [{ id: 'p1', name: 'Онбординг', confidence: null, trustTier: 'auto' }],
    });

    expect(groups[0].items[0].confidence).toBe(0);
  });

  it('пустые секции НЕ дают группу; непустые — дают', () => {
    const groups = buildEntityGroups({
      ...emptyRaw(),
      processes: [{ id: 'p1', name: 'Онбординг', confidence: 0.9, trustTier: 'human' }],
      // decisions / regulations / policies / metrics / tools — пустые
    });

    expect(groups).toHaveLength(1);
    expect(groups.map((g) => g.kind)).toEqual(['process']);
  });

  it('несколько непустых секций сохраняют порядок process→...→tool', () => {
    const groups = buildEntityGroups({
      processes: [{ id: 'p1', name: 'P', confidence: 1, trustTier: 'auto' }],
      decisions: [],
      regulations: [{ id: 'r1', name: 'R', confidence: 1, trustTier: 'human' }],
      policies: [],
      metrics: [{ id: 'm1', name: 'M', confidence: 1 }],
      tools: [{ id: 't1', name: 'T', confidence: 1 }],
    });

    expect(groups.map((g) => g.kind)).toEqual([
      'process',
      'regulation',
      'metric',
      'tool',
    ]);
  });

  it('undefined на входе → []', () => {
    expect(buildEntityGroups(undefined)).toEqual([]);
  });

  it('все секции пустые → []', () => {
    expect(buildEntityGroups(emptyRaw())).toEqual([]);
  });
});

describe('documentKindLabel (формат файла, Bug-1)', () => {
  it('маппит форматы в RU-метки', () => {
    expect(documentKindLabel('pdf')).toBe('PDF');
    expect(documentKindLabel('docx')).toBe('Word');
    expect(documentKindLabel('xlsx')).toBe('Excel');
    expect(documentKindLabel('pptx')).toBe('PowerPoint');
    expect(documentKindLabel('markdown')).toBe('Markdown');
    expect(documentKindLabel('text')).toBe('текст');
    expect(documentKindLabel('html')).toBe('HTML');
    expect(documentKindLabel('rtf')).toBe('RTF');
    expect(documentKindLabel('odt')).toBe('ODT');
    expect(documentKindLabel('csv')).toBe('CSV');
    expect(documentKindLabel('other')).toBe('другое');
  });
});

describe('documentTypeLabel (смысл документа)', () => {
  it('маппит смысловые типы в RU-метки', () => {
    expect(documentTypeLabel('regulation')).toBe('Регламент');
    expect(documentTypeLabel('policy')).toBe('Политика');
    expect(documentTypeLabel('instruction')).toBe('Инструкция');
    expect(documentTypeLabel('process')).toBe('Процесс');
    expect(documentTypeLabel('job_description')).toBe('Должностная инструкция');
    expect(documentTypeLabel('other')).toBe('другое');
  });

  it('null → «—» (тип не задан)', () => {
    expect(documentTypeLabel(null)).toBe('—');
  });
});

describe('ACCEPTED_DOCUMENT_EXTENSIONS (Bug-2)', () => {
  it('не содержит бинарный .doc', () => {
    expect(ACCEPTED_DOCUMENT_EXTENSIONS).not.toContain('.doc');
  });

  it('содержит ключевые форматы ТЗ-4', () => {
    for (const ext of ['.pdf', '.docx', '.xlsx', '.pptx', '.csv']) {
      expect(ACCEPTED_DOCUMENT_EXTENSIONS).toContain(ext);
    }
  });
});
