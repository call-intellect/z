import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import { SetClosedDefaultSchema, SetMatrixSchema } from './dto/knowledge-access.dto';
import { KnowledgeAccessAdminController } from './knowledge-access-admin.controller';
import type { KnowledgeAccessAdminService } from './knowledge-access-admin.service';

const TENANT = 'org-1';
const ADMIN: CurrentUserPayload = { id: 'admin-1', email: 'a@z.test', role: 'admin' };

function build() {
  const svc = {
    listGroups: vi.fn(async () => ({ items: [] })),
    getMatrix: vi.fn(async () => ({ items: [] })),
    setMatrix: vi.fn(async () => ({ ok: true as const, count: 1 })),
    listMembers: vi.fn(async () => ({ items: [] })),
    addMember: vi.fn(async () => ({ ok: true as const, added: true })),
    removeMember: vi.fn(async () => ({ ok: true as const, removed: true })),
    setMeetingTypeClosedDefault: vi.fn(async () => ({
      ok: true as const,
      typeId: 'interview',
      defaultClosedGroupKind: 'personal' as const,
    })),
  } as unknown as KnowledgeAccessAdminService;
  const ctrl = new KnowledgeAccessAdminController(svc);
  return { ctrl, svc };
}

describe('KnowledgeAccessAdminController', () => {
  it('PUT /matrix/:subjectGroupId — делегирует setMatrix с tenantId+visibleGroupIds', async () => {
    const { ctrl, svc } = build();
    await ctrl.setMatrix(TENANT, 'sales', { visibleGroupIds: ['logistics'] });
    expect(svc.setMatrix).toHaveBeenCalledWith(TENANT, 'sales', ['logistics']);
  });

  it('POST /groups/:groupId/members — делегирует addMember', async () => {
    const { ctrl, svc } = build();
    await ctrl.addMember(TENANT, 'council', { personId: 'p-1' });
    expect(svc.addMember).toHaveBeenCalledWith(TENANT, 'council', 'p-1');
  });

  it('DELETE /groups/:groupId/members/:personId — делегирует removeMember', async () => {
    const { ctrl, svc } = build();
    await ctrl.removeMember(TENANT, 'council', 'p-1');
    expect(svc.removeMember).toHaveBeenCalledWith(TENANT, 'council', 'p-1');
  });

  it('PATCH /meeting-types/:typeId/closed-default — пробрасывает user.id', async () => {
    const { ctrl, svc } = build();
    await ctrl.setClosedDefault('interview', ADMIN, { defaultClosedGroupKind: 'personal' });
    expect(svc.setMeetingTypeClosedDefault).toHaveBeenCalledWith(
      'interview',
      'personal',
      'admin-1',
    );
  });
});

describe('knowledge-access DTO validation', () => {
  it('SetClosedDefaultSchema принимает валидные значения и null', () => {
    expect(SetClosedDefaultSchema.parse({ defaultClosedGroupKind: 'council' })).toEqual({
      defaultClosedGroupKind: 'council',
    });
    expect(SetClosedDefaultSchema.parse({ defaultClosedGroupKind: null })).toEqual({
      defaultClosedGroupKind: null,
    });
  });

  it('SetClosedDefaultSchema отвергает невалидный enum', () => {
    expect(() =>
      SetClosedDefaultSchema.parse({ defaultClosedGroupKind: 'secret' }),
    ).toThrow();
  });

  it('SetMatrixSchema принимает массив строк', () => {
    expect(SetMatrixSchema.parse({ visibleGroupIds: ['a', 'b'] })).toEqual({
      visibleGroupIds: ['a', 'b'],
    });
  });
});
