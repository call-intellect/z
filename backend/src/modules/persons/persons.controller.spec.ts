/**
 * IDOR-fence spec для PersonsController (Phase F.7).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ListPersonsQuerySchema } from './dto/persons.dto';
import { PersonsController } from './persons.controller';

import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import type { RbacService } from '../rbac/rbac.service';
import type { PersonsService } from './services/persons.service';

const userA: CurrentUserPayload = { id: 'u-1', email: 'u@x', role: 'user' };

function build(opts: { canRead?: boolean } = {}) {
  const persons = {
    list: vi.fn(async () => ({ items: [], total: 0 } as never)),
    get: vi.fn(async () => ({ id: 'p-1' } as never)),
  } as unknown as PersonsService;
  const rbac = {
    canRead: vi.fn(async () => opts.canRead ?? true),
    canWrite: vi.fn(async () => true),
    check: vi.fn(async () => true),
  } as unknown as RbacService;
  return { ctrl: new PersonsController(persons, rbac), persons, rbac };
}

describe('PersonsController (IDOR fence)', () => {
  it('BadRequest tenant_required без X-Org-Id', async () => {
    const { ctrl } = build();
    const q = ListPersonsQuerySchema.parse({});
    await expect(ctrl.list(q, userA, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('403 forbidden cross-tenant (canRead=false)', async () => {
    const { ctrl } = build({ canRead: false });
    const q = ListPersonsQuerySchema.parse({});
    await expect(ctrl.list(q, userA, 'org-B')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('happy list: tenantId из @CurrentOrg в сервис', async () => {
    const { ctrl, persons } = build();
    const q = ListPersonsQuerySchema.parse({});
    await ctrl.list(q, userA, 'org-A');
    expect(persons.list).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-A' }),
    );
  });

  it('byId 403 cross-tenant', async () => {
    const { ctrl } = build({ canRead: false });
    await expect(ctrl.byId('p-foreign', userA, 'org-B')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
