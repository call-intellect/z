import { describe, expect, it, vi } from 'vitest';

import {
  markBlockMerged,
  markEntityMerged,
  setPersonEntity,
} from './entity-companion.helpers';

function makeClient() {
  return {
    person: { update: vi.fn().mockResolvedValue(undefined) },
    entity: { update: vi.fn().mockResolvedValue(undefined) },
    ideaBlock: { update: vi.fn().mockResolvedValue(undefined) },
  };
}

type MockClient = ReturnType<typeof makeClient>;

const asClient = (c: MockClient) => c as unknown as Parameters<typeof setPersonEntity>[0];

describe('entity-companion.helpers', () => {
  describe('setPersonEntity', () => {
    it('writes both entityId AND entityTenantId', async () => {
      const client = makeClient();
      await setPersonEntity(asClient(client), 'person-1', {
        id: 'entity-1',
        tenantId: 'tenant-1',
      });

      expect(client.person.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'person-1' },
          data: expect.objectContaining({
            entityId: 'entity-1',
            entityTenantId: 'tenant-1',
          }),
        }),
      );
    });

    it('tenant companion key is present in data', async () => {
      const client = makeClient();
      await setPersonEntity(asClient(client), 'person-1', {
        id: 'entity-1',
        tenantId: 'tenant-1',
      });

      const call = client.person.update.mock.calls.at(0)?.at(0) as {
        data: Record<string, unknown>;
      };
      expect(call.data).toHaveProperty('entityTenantId');
    });
  });

  describe('markEntityMerged', () => {
    it('writes both mergedIntoId AND mergedIntoTenantId, where matches from', async () => {
      const client = makeClient();
      await markEntityMerged(
        asClient(client),
        { id: 'from-1', tenantId: 'tenant-1' },
        { id: 'into-1', tenantId: 'tenant-1' },
      );

      expect(client.entity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id_tenantId: { id: 'from-1', tenantId: 'tenant-1' } },
          data: expect.objectContaining({
            mergedIntoId: 'into-1',
            mergedIntoTenantId: 'tenant-1',
          }),
        }),
      );
    });

    it('tenant companion key is present in data', async () => {
      const client = makeClient();
      await markEntityMerged(
        asClient(client),
        { id: 'from-1', tenantId: 'tenant-1' },
        { id: 'into-1', tenantId: 'tenant-1' },
      );

      const call = client.entity.update.mock.calls.at(0)?.at(0) as {
        data: Record<string, unknown>;
      };
      expect(call.data).toHaveProperty('mergedIntoTenantId');
    });
  });

  describe('markBlockMerged', () => {
    it('writes status merged_into + both mergedIntoId AND mergedIntoTenantId', async () => {
      const client = makeClient();
      await markBlockMerged(
        asClient(client),
        { id: 'block-1', tenantId: 'tenant-1' },
        { id: 'canonical-1', tenantId: 'tenant-1' },
      );

      expect(client.ideaBlock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id_tenantId: { id: 'block-1', tenantId: 'tenant-1' } },
          data: expect.objectContaining({
            status: 'merged_into',
            mergedIntoId: 'canonical-1',
            mergedIntoTenantId: 'tenant-1',
          }),
        }),
      );
    });

    it('tenant companion key is present in data', async () => {
      const client = makeClient();
      await markBlockMerged(
        asClient(client),
        { id: 'block-1', tenantId: 'tenant-1' },
        { id: 'canonical-1', tenantId: 'tenant-1' },
      );

      const call = client.ideaBlock.update.mock.calls.at(0)?.at(0) as {
        data: Record<string, unknown>;
      };
      expect(call.data).toHaveProperty('mergedIntoTenantId');
    });
  });
});
