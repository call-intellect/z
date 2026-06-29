import { describe, expect, it, vi } from 'vitest';

import { ClosureVerifierService } from './closure-verifier.service';

const VALID_VERDICT = {
  done: true,
  confidence: 0.9,
  rationale: 'Прямо сказано, что КП отправлено.',
  positiveSignals: ['собрал', 'отправил на почту'],
  negativeSignals: [],
};

function makeService(opts: { call: ReturnType<typeof vi.fn> }) {
  const llm = { call: opts.call };
  const svc = new ClosureVerifierService(llm as never, null);
  return { svc, llm };
}

const baseArgs = {
  tenantId: 't1',
  taskTitle: 'Отправить КП клиенту Бета',
  signalType: 'task_completed',
  quote: 'КП собрал и утром отправил им на почту',
};

describe('ClosureVerifierService', () => {
  it('валидный JSON-вердикт → парсит и возвращает {done,confidence,...}', async () => {
    const call = vi.fn().mockResolvedValue({ text: JSON.stringify(VALID_VERDICT) });
    const { svc, llm } = makeService({ call });

    const verdict = await svc.verify(baseArgs);

    expect(verdict).toEqual(VALID_VERDICT);
    expect(llm.call).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'task-closure-verify', tenantId: 't1' }),
    );
  });

  it('невалидный JSON на всех попытках → null (после ретраев)', async () => {
    const call = vi.fn().mockResolvedValue({ text: '{не json' });
    const { svc, llm } = makeService({ call });

    const verdict = await svc.verify(baseArgs);

    expect(verdict).toBeNull();
    expect(llm.call).toHaveBeenCalledTimes(2);
  });

  it('LLM кидает ошибку оба раза → null', async () => {
    const call = vi.fn().mockRejectedValue(new Error('llm упал'));
    const { svc, llm } = makeService({ call });

    const verdict = await svc.verify(baseArgs);

    expect(verdict).toBeNull();
    expect(llm.call).toHaveBeenCalledTimes(2);
  });
});
