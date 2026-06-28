import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { ConversationService } from '../services/conversation.service';

import { HrMembershipListener } from './hr-membership.listener';

function build(opts: { enabled?: boolean; companyChannelId?: string } = {}) {
  const ensureCompanyChannel = vi.fn(async () => ({ id: opts.companyChannelId ?? 'company-1' }));
  const addMember = vi.fn(async () => undefined);
  const removeAutoMembershipsForUser = vi.fn(async () => 2);

  const conversations = {
    ensureCompanyChannel,
    addMember,
    removeAutoMembershipsForUser,
  } as unknown as ConversationService;

  const cfg = {
    getDynamic: vi.fn(async () => opts.enabled ?? true),
  } as unknown as TypedConfigService;

  const listener = new HrMembershipListener(conversations, cfg);
  return { listener, ensureCompanyChannel, addMember, removeAutoMembershipsForUser };
}

describe('HrMembershipListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('membership.created → addMember в company-channel с source=auto', async () => {
    const { listener, ensureCompanyChannel, addMember } = build();

    await listener.onCreated({ tenantId: 'org-1', userId: 'u-1' });

    expect(ensureCompanyChannel).toHaveBeenCalledWith('org-1', 'u-1');
    expect(addMember).toHaveBeenCalledWith({
      conversationId: 'company-1',
      userId: 'u-1',
      source: 'auto',
    });
  });

  it('membership.created идемпотентно: повтор → addMember снова (upsert не падает)', async () => {
    const { listener, addMember } = build();

    await listener.onCreated({ tenantId: 'org-1', userId: 'u-1' });
    await listener.onCreated({ tenantId: 'org-1', userId: 'u-1' });

    expect(addMember).toHaveBeenCalledTimes(2);
  });

  it('membership.removed → удаляет только source=auto', async () => {
    const { listener, removeAutoMembershipsForUser } = build();

    await listener.onRemoved({ tenantId: 'org-1', userId: 'u-1' });

    expect(removeAutoMembershipsForUser).toHaveBeenCalledWith('org-1', 'u-1');
  });

  it('гейт off → created/removed no-op', async () => {
    const { listener, ensureCompanyChannel, addMember, removeAutoMembershipsForUser } = build({
      enabled: false,
    });

    await listener.onCreated({ tenantId: 'org-1', userId: 'u-1' });
    await listener.onRemoved({ tenantId: 'org-1', userId: 'u-1' });

    expect(ensureCompanyChannel).not.toHaveBeenCalled();
    expect(addMember).not.toHaveBeenCalled();
    expect(removeAutoMembershipsForUser).not.toHaveBeenCalled();
  });
});
