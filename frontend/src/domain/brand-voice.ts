/**
 * SBA β-7 — доменная модель BrandVoiceProfile.
 *
 * Слой UiModel: дата как Date, добавлены display-метки, отсортированные
 * списки tone-осей по убыванию.
 */

import type {
  BrandVoiceProfileApi,
  BrandVoiceTabooApi,
  BrandVoiceValueApi,
} from '@/api/brand-voice.api';

/** Русские метки 10 осей тона (соответствуют backend BRAND_VOICE_TONE_DIMENSIONS). */
export const BRAND_VOICE_TONE_LABEL: Record<string, string> = {
  formal: 'Формальность',
  technical: 'Техничность',
  casual: 'Непринуждённость',
  energetic: 'Энергичность',
  authoritative: 'Авторитетность',
  friendly: 'Дружелюбность',
  playful: 'Игривость',
  minimalist: 'Минимализм',
  expressive: 'Выразительность',
  inclusive: 'Инклюзивность',
};

/**
 * Метки статуса артефакта brand-corpus (= `DocumentStatus` backend).
 * Неизвестный код → человеческий фолбэк через `replaceAll`.
 */
const BRAND_VOICE_ARTIFACT_STATUS_LABEL: Record<string, string> = {
  uploaded: 'Загружен',
  parsing: 'Разбираем',
  parsed: 'Разобран',
  blocks_extracted: 'Проиндексирован',
  failed: 'Ошибка',
};

export function brandVoiceArtifactStatusLabel(status: string): string {
  return BRAND_VOICE_ARTIFACT_STATUS_LABEL[status] ?? status.replaceAll('_', ' ');
}

export interface ToneAxisDomain {
  key: string;
  label: string;
  value: number;
  /** 0..100. */
  percent: number;
}

export interface BrandVoiceProfileDomain {
  id: string;
  tenantId: string;
  /** Отсортированный по убыванию список осей. */
  tone: ToneAxisDomain[];
  values: BrandVoiceValueApi[];
  taboos: BrandVoiceTabooApi[];
  exampleArtifactIds: string[];
  version: number;
  lastBuiltAt: Date | null;
  builderAgentVersion: string | null;
  completeness: number;
  /** 0..100. */
  completenessPercent: number;
  corpusSize: number;
  belowCorpusThreshold: boolean;
  minCorpusSize: number;
  updatedAt: Date;
}

export function toBrandVoiceProfileDomain(
  api: BrandVoiceProfileApi,
): BrandVoiceProfileDomain {
  const tone: ToneAxisDomain[] = api.tone
    ? Object.entries(api.tone)
        .filter(
          (e): e is [string, number] =>
            typeof e[1] === 'number' && Number.isFinite(e[1]),
        )
        .map(([key, value]) => ({
          key,
          label: BRAND_VOICE_TONE_LABEL[key] ?? key,
          value,
          percent: Math.round(Math.max(0, Math.min(1, value)) * 100),
        }))
        .sort((a, b) => b.value - a.value)
    : [];

  return {
    id: api.id,
    tenantId: api.tenantId,
    tone,
    values: api.values ?? [],
    taboos: api.taboos ?? [],
    exampleArtifactIds: api.exampleArtifactIds,
    version: api.version,
    lastBuiltAt: api.lastBuiltAt ? new Date(api.lastBuiltAt) : null,
    builderAgentVersion: api.builderAgentVersion,
    completeness: api.completeness,
    completenessPercent: Math.round(
      Math.max(0, Math.min(1, api.completeness)) * 100,
    ),
    corpusSize: api.corpusSize,
    belowCorpusThreshold: api.belowCorpusThreshold,
    minCorpusSize: api.minCorpusSize,
    updatedAt: new Date(api.updatedAt),
  };
}
