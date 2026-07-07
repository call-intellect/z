import { describe, expect, it } from 'vitest';

import { WorkerDisabledForOrgError, WorkerOrgGate } from './worker-org-gate';

type OrgRow = {
  workersEnabled: unknown;
  deletedAt: Date | null;
  demoWorkspaceSeededAt: Date | null;
};

function makeGate(org: OrgRow | null, demoIngestEnabled: boolean): WorkerOrgGate {
  const prisma = {
    org: { findUnique: async () => org },
  } as unknown as ConstructorParameters<typeof WorkerOrgGate>[0];
  const config = {
    resolveSync: () => demoIngestEnabled,
  } as unknown as ConstructorParameters<typeof WorkerOrgGate>[1];
  return new WorkerOrgGate(prisma, config);
}

const demoOrg: OrgRow = {
  workersEnabled: {},
  deletedAt: null,
  demoWorkspaceSeededAt: new Date('2026-07-02T00:00:00Z'),
};

const realOrg: OrgRow = {
  workersEnabled: {},
  deletedAt: null,
  demoWorkspaceSeededAt: null,
};

describe('WorkerOrgGate', () => {
  it('пропускает без tenantId', async () => {
    const gate = makeGate(null, false);
    await expect(gate.checkOrThrow(null, 'block-ingest')).resolves.toBeUndefined();
  });

  it('демо-орг + ingest OFF → бросает WorkerDisabledForOrgError', async () => {
    const gate = makeGate(demoOrg, false);
    await expect(gate.checkOrThrow('t1', 'block-ingest')).rejects.toBeInstanceOf(
      WorkerDisabledForOrgError,
    );
  });

  it('демо-орг + ingest ON → не бросает', async () => {
    const gate = makeGate(demoOrg, true);
    await expect(gate.checkOrThrow('t1', 'block-ingest')).resolves.toBeUndefined();
  });

  it('реальный орг + ingest OFF → не бросает (флаг только для демо)', async () => {
    const gate = makeGate(realOrg, false);
    await expect(gate.checkOrThrow('t1', 'block-ingest')).resolves.toBeUndefined();
  });

  it('deletedAt → бросает (существующее поведение)', async () => {
    const gate = makeGate({ ...realOrg, deletedAt: new Date() }, true);
    await expect(gate.checkOrThrow('t1', 'block-ingest')).rejects.toBeInstanceOf(
      WorkerDisabledForOrgError,
    );
  });

  it('workersEnabled[worker]===false → бросает (существующее поведение)', async () => {
    const gate = makeGate({ ...realOrg, workersEnabled: { 'block-ingest': false } }, true);
    await expect(gate.checkOrThrow('t1', 'block-ingest')).rejects.toBeInstanceOf(
      WorkerDisabledForOrgError,
    );
  });
});
