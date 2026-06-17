import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { PendingPatchesController } from './controllers/pending-patches.controller';
import { TablesController } from './controllers/tables.controller';
import { TablesModule } from './tables.module';

describe('TablesModule controller registration order', () => {
  it('registers PendingPatchesController before TablesController (static `pending-patches` must beat dynamic `:id`)', () => {
    const controllers = Reflect.getMetadata('controllers', TablesModule) as unknown[];
    expect(controllers).toBeDefined();
    const pendingIdx = controllers.indexOf(PendingPatchesController);
    const tablesIdx = controllers.indexOf(TablesController);
    expect(pendingIdx).toBeGreaterThanOrEqual(0);
    expect(tablesIdx).toBeGreaterThanOrEqual(0);
    expect(pendingIdx).toBeLessThan(tablesIdx);
  });
});
