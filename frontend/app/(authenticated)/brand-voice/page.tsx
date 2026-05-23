import type { Metadata } from 'next';

import { BrandVoiceClient } from './BrandVoiceClient';

export const metadata: Metadata = {
  title: 'Голос бренда',
};

/**
 * `/brand-voice` — профиль голоса бренда (SBA β-7, Specialist 3.10).
 *
 * Хранит tone (10 осей), values (ценности), taboos (что нельзя писать),
 * exampleArtifactIds (документы из brand_corpus). Daily-cron пересобирает
 * профиль из документов с useCases includes 'brand_corpus' + IdeaBlock'ов
 * с signalType='brand_principle'.
 */
export default function BrandVoicePage() {
  return <BrandVoiceClient />;
}
