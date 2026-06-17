import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';

import { AdminAiModelsController } from './ai-models.controller';
import type { AdminAiModelsService } from './ai-models.service';

const sampleUser: CurrentUserPayload = {
  id: 'u-1',
  email: 'admin@z.test',
  role: 'admin',
};

function build() {
  const svc = {
    list: vi.fn(async () => [{ taskType: 'summary' }]),
    detail: vi.fn(async () => ({ taskType: 'summary' })),
    switchPrimary: vi.fn(async () => ({ ok: true as const })),
    addProvider: vi.fn(async () => ({ ok: true as const })),
    removeProvider: vi.fn(async () => ({ ok: true as const })),
    history: vi.fn(async () => []),
    metrics_: vi.fn(async () => ({ period: '7d' })),
    createExperiment: vi.fn(async () => ({ id: 'e-1' })),
    listExperiments: vi.fn(async () => []),
    startExperiment: vi.fn(async () => ({ ok: true as const })),
    stopExperiment: vi.fn(async () => ({ ok: true as const })),
    experimentAnalytics: vi.fn(async () => ({ experiment: {}, control: {}, variant: {} })),
  } as unknown as AdminAiModelsService;
  const ctrl = new AdminAiModelsController(svc);
  return { ctrl, svc };
}

describe('AdminAiModelsController', () => {
  it('GET /ai-models — делегирует list с фильтрами', async () => {
    const { ctrl, svc } = build();
    const out = await ctrl.list({ group: 'ai-pipeline' });
    expect(svc.list).toHaveBeenCalledWith({ group: 'ai-pipeline' });
    expect(out).toEqual({ items: [{ taskType: 'summary' }] });
  });

  it('POST /ai-models/:taskType/switch-primary — пробрасывает user.id в сервис', async () => {
    const { ctrl, svc } = build();
    await ctrl.switchPrimary(
      'summary',
      { providerName: 'openai-via-proxy', model: 'gpt-5.5', reason: 'тест' },
      sampleUser,
    );
    expect(svc.switchPrimary).toHaveBeenCalledWith(
      'summary',
      expect.objectContaining({ providerName: 'openai-via-proxy', reason: 'тест' }),
      'u-1',
    );
  });

  it('DELETE /ai-models/:taskType/provider/:providerId — делегирует removeProvider', async () => {
    const { ctrl, svc } = build();
    await ctrl.removeProvider('summary', 'r-1', sampleUser);
    expect(svc.removeProvider).toHaveBeenCalledWith('summary', 'r-1', 'u-1');
  });

  it('GET /ai-models/:taskType/history — возвращает { items: [] }', async () => {
    const { ctrl, svc } = build();
    const out = await ctrl.history('summary');
    expect(svc.history).toHaveBeenCalledWith('summary', 50);
    expect(out).toEqual({ items: [] });
  });

  it('switchPrimary без user — бросает BadRequestException', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.switchPrimary(
        'summary',
        { providerName: 'openai-via-proxy', model: 'gpt-5.5', reason: 'тест' },
        null,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'no_user_context' }),
      }),
    });
  });
});
