import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeEntityId,
  canonicalizeEntityIds,
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

function makeCanonClient(chain: Record<string, string | null>) {
  const findUnique = vi.fn(async (args: { where: { id_tenantId: { id: string } } }) => {
    const id = args.where.id_tenantId.id;
    if (!(id in chain)) return null;
    return { mergedIntoId: chain[id] };
  });
  return { findUnique, client: { entity: { findUnique } } };
}

const asCanonClient = (c: { entity: { findUnique: unknown } }) =>
  c as unknown as Parameters<typeof canonicalizeEntityId>[0];

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

  describe('canonicalizeEntityId', () => {
    it('follows a 2-hop chain A→B→C to the canonical C', async () => {
      const { client } = makeCanonClient({ A: 'B', B: 'C', C: null });
      const result = await canonicalizeEntityId(asCanonClient(client), 'tenant-1', 'A');
      expect(result).toBe('C');
    });

    it('returns the entity itself when it has no mergedIntoId', async () => {
      const { client } = makeCanonClient({ X: null });
      const result = await canonicalizeEntityId(asCanonClient(client), 'tenant-1', 'X');
      expect(result).toBe('X');
    });

    it('does not loop forever on a cycle A→B→A', async () => {
      const { client, findUnique } = makeCanonClient({ A: 'B', B: 'A' });
      const result = await canonicalizeEntityId(asCanonClient(client), 'tenant-1', 'A');
      expect(['A', 'B']).toContain(result);
      expect(findUnique.mock.calls.length).toBeLessThanOrEqual(16);
    });

    it('returns the last known id when an entity row is missing', async () => {
      const { client } = makeCanonClient({ A: 'B' });
      const result = await canonicalizeEntityId(asCanonClient(client), 'tenant-1', 'A');
      expect(result).toBe('B');
    });
  });

  describe('canonicalizeEntityIds', () => {
    it('maps every input id to its canonical (A→C, B→C, C→C)', async () => {
      const { client } = makeCanonClient({ A: 'B', B: 'C', C: null });
      const map = await canonicalizeEntityIds(asCanonClient(client), 'tenant-1', [
        'A',
        'B',
        'C',
      ]);
      expect(map.get('A')).toBe('C');
      expect(map.get('B')).toBe('C');
      expect(map.get('C')).toBe('C');
    });

    it('returns an empty map for empty input', async () => {
      const { client, findUnique } = makeCanonClient({});
      const map = await canonicalizeEntityIds(asCanonClient(client), 'tenant-1', []);
      expect(map.size).toBe(0);
      expect(findUnique).not.toHaveBeenCalled();
    });
  });
});
