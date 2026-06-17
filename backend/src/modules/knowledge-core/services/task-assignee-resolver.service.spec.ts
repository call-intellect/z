import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';

import { TaskAssigneeResolverService } from './task-assignee-resolver.service';

function makeResolver(): {
  service: TaskAssigneeResolverService;
  incAmbiguous: ReturnType<typeof vi.fn>;
} {
  const incAmbiguous = vi.fn();
  const metrics = {
    incTaskAssigneeAmbiguous: incAmbiguous,
  } as unknown as BusinessMetricsService;
  return {
    service: new TaskAssigneeResolverService(metrics),
    incAmbiguous,
  };
}

const HOST_ANNA: AiParticipantContext = {
  livekitIdentity: 'host:user_anna',
  displayName: 'Анна',
  userId: 'user_anna',
  fullName: 'Анна Иванова',
  role: 'host',
};
const HOST_SERGEY_ONE: AiParticipantContext = {
  livekitIdentity: 'host:user_s1',
  displayName: 'Сергей',
  userId: 'user_s1',
  fullName: 'Сергей Иванов',
  role: 'host',
};
const HOST_SERGEY_TWO: AiParticipantContext = {
  livekitIdentity: 'host:user_s2',
  displayName: 'Сергей',
  userId: 'user_s2',
  fullName: 'Сергей Петров',
  role: 'host',
};
const GUEST_IVAN: AiParticipantContext = {
  livekitIdentity: 'guest:n1',
  displayName: 'Иван',
  userId: null,
  fullName: null,
  role: 'guest',
};

describe('TaskAssigneeResolverService.resolve', () => {
  it('ветка 1 — LLM вернул валидный userId из списка participants', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'Анна', assigneeUserId: 'user_anna' }],
      [HOST_ANNA],
      'tenant-1',
    );
    expect(result).toEqual([
      { assigneeRaw: 'Анна', assigneeUserId: 'user_anna', ambiguous: false },
    ]);
    expect(incAmbiguous).not.toHaveBeenCalled();
  });

  it('ветка 2 — LLM-галлюцинация: userId не в participants → null + метрика', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [
        {
          assigneeRaw: 'Чужой',
          assigneeUserId: 'user_evil',
        },
      ],
      [HOST_ANNA],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBeNull();
    expect(result[0]?.ambiguous).toBe(false);
    expect(incAmbiguous).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      reason: 'llm_hallucination',
    });
  });

  it('ветка 2 fallback — галлюцинация userId, но raw матчится → userId восстановлен', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'Анна', assigneeUserId: 'user_evil' }],
      [HOST_ANNA],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBe('user_anna');
    expect(incAmbiguous).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      reason: 'llm_hallucination',
    });
  });

  it('ветка 3 — только assigneeRaw, точный матч по displayName', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'анна', assigneeUserId: null }],
      [HOST_ANNA],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBe('user_anna');
    expect(result[0]?.ambiguous).toBe(false);
    expect(incAmbiguous).not.toHaveBeenCalled();
  });

  it('ветка 3 — точный матч по fullName (Серёжа vs Сергей Иванов)', () => {
    const customAnna: AiParticipantContext = {
      ...HOST_ANNA,
      displayName: 'Серёжа',
      userId: 'user_serj',
      fullName: 'Сергей Иванов',
    };
    const { service } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'Сергей Иванов', assigneeUserId: null }],
      [customAnna],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBe('user_serj');
  });

  it('ветка 4 — два host с одинаковым name → ambiguous + метрика duplicate_name', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'Сергей', assigneeUserId: null }],
      [HOST_SERGEY_ONE, HOST_SERGEY_TWO],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBeNull();
    expect(result[0]?.ambiguous).toBe(true);
    expect(incAmbiguous).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      reason: 'duplicate_name',
    });
  });

  it('ветка «нет матча» — assigneeRaw не в participants (роль / гость по имени)', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'маркетинг', assigneeUserId: null }],
      [HOST_ANNA],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBeNull();
    expect(result[0]?.ambiguous).toBe(false);
    expect(incAmbiguous).not.toHaveBeenCalled();
  });

  it('participants пусты → всегда null', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [
        { assigneeRaw: 'Сергей', assigneeUserId: 'user_evil' },
        { assigneeRaw: 'Анна', assigneeUserId: null },
      ],
      [],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBeNull();
    expect(result[1]?.assigneeUserId).toBeNull();
    expect(incAmbiguous).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      reason: 'llm_hallucination',
    });
  });

  it('guest в participants → не участвует в матчинге (userId=null)', () => {
    const { service } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'Иван', assigneeUserId: null }],
      [GUEST_IVAN, HOST_ANNA],
      'tenant-1',
    );
    expect(result[0]?.assigneeUserId).toBeNull();
    expect(result[0]?.ambiguous).toBe(false);
  });

  it('tenantId=null → метрика НЕ инкрементируется', () => {
    const { service, incAmbiguous } = makeResolver();
    const result = service.resolve(
      [{ assigneeRaw: 'Сергей', assigneeUserId: null }],
      [HOST_SERGEY_ONE, HOST_SERGEY_TWO],
      null,
    );
    expect(result[0]?.ambiguous).toBe(true);
    expect(incAmbiguous).not.toHaveBeenCalled();
  });
});
