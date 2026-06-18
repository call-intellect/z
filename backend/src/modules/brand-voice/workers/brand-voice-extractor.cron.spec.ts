import { describe, expect, it, vi } from 'vitest';

import { BrandVoiceExtractorCron } from './brand-voice-extractor.cron';

describe('BrandVoiceExtractorCron', () => {
  it('happy-path: вызывает runForAllTenants и не падает', async () => {
    const stats = {
      tenantsScanned: 3,
      tenantsBuilt: 2,
      tenantsSkippedLowCorpus: 1,
      tenantsSkippedDisabled: 0,
    };
    const extractor = {
      runForAllTenants: vi.fn().mockResolvedValue(stats),
    };
    const cron = new BrandVoiceExtractorCron(extractor as never);
    await expect(cron.run()).resolves.toBeUndefined();
    expect(extractor.runForAllTenants).toHaveBeenCalledOnce();
  });

  it('перехватывает ошибки runForAllTenants и не пробрасывает', async () => {
    const extractor = {
      runForAllTenants: vi.fn().mockRejectedValue(new Error('LLM-провайдер недоступен')),
    };
    const cron = new BrandVoiceExtractorCron(extractor as never);
    await expect(cron.run()).resolves.toBeUndefined();
    expect(extractor.runForAllTenants).toHaveBeenCalledOnce();
  });
});
