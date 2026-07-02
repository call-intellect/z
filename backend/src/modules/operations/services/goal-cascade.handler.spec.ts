import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalCascadeHandler } from './goal-cascade.handler';

function makeHandler(): {
  handler: GoalCascadeHandler;
  cascade: { onChildCompleted: ReturnType<typeof vi.fn>; onParentMissed: ReturnType<typeof vi.fn> };
} {
  const cascade = {
    onChildCompleted: vi.fn(async () => null),
    onParentMissed: vi.fn(async () => 0),
  };
  const handler = new GoalCascadeHandler(cascade as never);
  return { handler, cascade };
}

describe('GoalCascadeHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('newStatus=achieved → вызывает onChildCompleted, не вызывает onParentMissed', async () => {
    const { handler, cascade } = makeHandler();
    await handler.handle({
      tenantId: 't1',
      goalId: 'g1',
      oldStatus: 'active',
      newStatus: 'achieved',
    });
    expect(cascade.onChildCompleted).toHaveBeenCalledTimes(1);
    expect(cascade.onChildCompleted).toHaveBeenCalledWith({ tenantId: 't1', goalId: 'g1' });
    expect(cascade.onParentMissed).not.toHaveBeenCalled();
  });

  it('newStatus=abandoned → вызывает onParentMissed, не вызывает onChildCompleted', async () => {
    const { handler, cascade } = makeHandler();
    await handler.handle({
      tenantId: 't1',
      goalId: 'g1',
      oldStatus: 'active',
      newStatus: 'abandoned',
    });
    expect(cascade.onParentMissed).toHaveBeenCalledTimes(1);
    expect(cascade.onParentMissed).toHaveBeenCalledWith({ tenantId: 't1', parentGoalId: 'g1' });
    expect(cascade.onChildCompleted).not.toHaveBeenCalled();
  });

  it('newStatus=active → ни один каскад не вызывается', async () => {
    const { handler, cascade } = makeHandler();
    await handler.handle({
      tenantId: 't1',
      goalId: 'g1',
      oldStatus: 'paused',
      newStatus: 'active',
    });
    expect(cascade.onChildCompleted).not.toHaveBeenCalled();
    expect(cascade.onParentMissed).not.toHaveBeenCalled();
  });

  it('каскад бросает ошибку → handle не реджектится', async () => {
    const { handler, cascade } = makeHandler();
    cascade.onChildCompleted.mockRejectedValueOnce(new Error('boom'));
    await expect(
      handler.handle({
        tenantId: 't1',
        goalId: 'g1',
        oldStatus: 'active',
        newStatus: 'achieved',
      }),
    ).resolves.toBeUndefined();
  });
});
