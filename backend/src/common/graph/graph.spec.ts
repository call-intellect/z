import { describe, expect, it } from 'vitest';

import { CypherBuilder } from './cypher-builder';

/**
 * Юнит-тесты CypherBuilder — единственное, что можно проверять без живой
 * БД с AGE. Остальные сценарии (`addNode is idempotent`, `addEdge двойная
 * запись`, `removeEdge soft-delete`, `getNeighbors`) — в `describe.skip`
 * ниже, потому что требуют поднятый Postgres + Apache AGE
 * (`docker compose up postgres` с `infra/postgres/Dockerfile`, см. план
 * `plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md` §5).
 */
describe('CypherBuilder', () => {
  describe('toAgeLabel', () => {
    it('replaces dashes with underscores for compound NodeTypes', () => {
      expect(CypherBuilder.toAgeLabel('job-description')).toBe('job_description');
      expect(CypherBuilder.toAgeLabel('role-profile')).toBe('role_profile');
      expect(CypherBuilder.toAgeLabel('process-step')).toBe('process_step');
      expect(CypherBuilder.toAgeLabel('idea-block')).toBe('idea_block');
    });

    it('keeps simple NodeTypes as is', () => {
      expect(CypherBuilder.toAgeLabel('role')).toBe('role');
      expect(CypherBuilder.toAgeLabel('person')).toBe('person');
      expect(CypherBuilder.toAgeLabel('meeting')).toBe('meeting');
    });

    it('throws on unknown NodeType (защита от Cypher injection)', () => {
      expect(() =>
        // @ts-expect-error — намеренно передаём невалидный тип
        CypherBuilder.toAgeLabel('drop-table'),
      ).toThrow(/Unknown NodeType/);
    });
  });

  describe('toRelType', () => {
    it('accepts whitelisted EntityLinkType values', () => {
      expect(CypherBuilder.toRelType('executes_role')).toBe('executes_role');
      expect(CypherBuilder.toRelType('member_of')).toBe('member_of');
      expect(CypherBuilder.toRelType('has_step')).toBe('has_step');
      expect(CypherBuilder.toRelType('mentions_with')).toBe('mentions_with');
    });

    it('throws on unknown linkType', () => {
      expect(() => CypherBuilder.toRelType('drop_table_users')).toThrow(
        /Unknown EntityLinkType/,
      );
      expect(() => CypherBuilder.toRelType("'; DROP TABLE x; --")).toThrow(
        /Unknown EntityLinkType/,
      );
    });
  });

  describe('escapeString', () => {
    it('escapes backslashes and single quotes', () => {
      expect(CypherBuilder.escapeString("O'Brien")).toBe("O\\'Brien");
      expect(CypherBuilder.escapeString('path\\to\\file')).toBe(
        'path\\\\to\\\\file',
      );
      expect(CypherBuilder.escapeString("a'b\\c")).toBe("a\\'b\\\\c");
    });

    it('leaves plain ASCII untouched', () => {
      expect(CypherBuilder.escapeString('clr_abc123')).toBe('clr_abc123');
    });
  });

  describe('buildMergeNode', () => {
    it('builds MERGE с id и tenant_id', () => {
      const cypher = CypherBuilder.buildMergeNode(
        'role',
        'clr_role1',
        'clr_org1',
      );
      expect(cypher).toBe(
        "MERGE (n:role {id: 'clr_role1', tenant_id: 'clr_org1'})",
      );
    });

    it('escapes dashes в label', () => {
      const cypher = CypherBuilder.buildMergeNode(
        'job-description',
        'clr_jd1',
        'clr_org1',
      );
      expect(cypher).toContain(':job_description');
    });
  });

  describe('buildMergeEdge', () => {
    it('строит MATCH + MERGE с правильными метками', () => {
      const cypher = CypherBuilder.buildMergeEdge({
        fromType: 'person',
        fromId: 'clr_p1',
        toType: 'role',
        toId: 'clr_r1',
        linkType: 'executes_role',
        tenantId: 'clr_org1',
      });
      expect(cypher).toContain(':person {id: \'clr_p1\'');
      expect(cypher).toContain(':role {id: \'clr_r1\'');
      expect(cypher).toContain('MERGE (a)-[r:executes_role]->(b)');
    });

    it('падает на неизвестном linkType', () => {
      expect(() =>
        CypherBuilder.buildMergeEdge({
          fromType: 'person',
          fromId: 'p1',
          toType: 'role',
          toId: 'r1',
          linkType: 'arbitrary_attack',
          tenantId: 'o1',
        }),
      ).toThrow(/Unknown EntityLinkType/);
    });
  });

  describe('buildDeleteEdge', () => {
    it('строит MATCH + DELETE для конкретного ребра', () => {
      const cypher = CypherBuilder.buildDeleteEdge({
        fromType: 'process',
        fromId: 'clr_pr1',
        toType: 'metric',
        toId: 'clr_m1',
        linkType: 'measured_by',
        tenantId: 'clr_org1',
      });
      expect(cypher).toContain(':process');
      expect(cypher).toContain(':metric');
      expect(cypher).toContain('[r:measured_by]');
      expect(cypher).toContain('DELETE r');
    });
  });

  describe('buildRelTypeFilter', () => {
    it('возвращает null для пустого/отсутствующего фильтра', () => {
      expect(CypherBuilder.buildRelTypeFilter(undefined)).toBeNull();
      expect(CypherBuilder.buildRelTypeFilter([])).toBeNull();
    });

    it('собирает CSV из quoted значений', () => {
      expect(
        CypherBuilder.buildRelTypeFilter(['executes_role', 'member_of']),
      ).toBe("'executes_role','member_of'");
    });

    it('падает, если в списке невалидный linkType', () => {
      expect(() =>
        CypherBuilder.buildRelTypeFilter(['executes_role', 'attack']),
      ).toThrow(/Unknown EntityLinkType/);
    });
  });
});

/**
 * Integration-тесты GraphService требуют живой PostgreSQL + Apache AGE
 * (`infra/postgres/Dockerfile`, см. план Фазы 0a §5). На CI/dev без AGE
 * они пропускаются — отсюда `describe.skip`.
 *
 * Запуск локально (когда AGE поднят):
 *   1. `docker compose --profile postgres-age up -d postgres` (или
 *      `bun run apply-postgres-init` после прокачки `prisma db push`).
 *   2. Заменить `describe.skip` → `describe`, прогнать `bun run test:integration`.
 *
 * TODO (после 0a.2):
 *   - подключить к существующему test-harness'у (есть ли setup-файл, который
 *     поднимает testcontainers + миграции). Если нет — описать в плане 0a.2.
 */
describe.skip('GraphService (integration — требует AGE)', () => {
  it('addNode идемпотентен — два MERGE с одним id не падают', async () => {
    // 1. Поднять AppModule с настоящим PrismaService.
    // 2. graph.addNode({ tenantId, type: 'role', id: 'r1' })
    // 3. graph.addNode({ tenantId, type: 'role', id: 'r1' }) — не падает.
    // 4. Cypher MATCH (n:role {id:'r1'}) — должен вернуть ровно один узел.
    expect.fail('требует AGE-контейнер, см. infra/postgres');
  });

  it('addEdge пишет одновременно в EntityLink (Postgres) и AGE (rollback при ошибке)', async () => {
    // 1. addEdge({ from: {type:'person', id:'p1'}, to:{type:'role', id:'r1'},
    //              linkType:'executes_role' })
    // 2. Проверить: prisma.entityLink.findFirst({...}) → не null,
    //    cypher MATCH (a:person)-[r:executes_role]->(b:role) — возвращает 1 ребро.
    // 3. Имитировать AGE-ошибку (например, удалить узел между шагами) —
    //    транзакция должна откатить EntityLink.
    expect.fail('требует AGE-контейнер, см. infra/postgres');
  });

  it('removeEdge делает soft-delete в Postgres и DELETE в AGE', async () => {
    // 1. addEdge → проверить EntityLink.deletedAt = null + AGE есть.
    // 2. removeEdge → EntityLink.deletedAt != null + status='archived';
    //    AGE — ребра нет.
    expect.fail('требует AGE-контейнер, см. infra/postgres');
  });

  it('getNeighbors возвращает соседей с фильтром по linkTypes', async () => {
    // 1. addEdge много рёбер разных типов.
    // 2. getNeighbors({ node, linkTypes: ['executes_role'] }) — только этот тип.
    // 3. direction='out' / 'in' / 'both' — корректно фильтрует.
    expect.fail('требует AGE-контейнер, см. infra/postgres');
  });

  it('findPath возвращает кратчайший путь между двумя узлами', async () => {
    // Граф: person → role → process → metric. findPath(person→metric)
    // должен вернуть путь длины 3.
    expect.fail('требует AGE-контейнер, см. infra/postgres');
  });

  it('upsertEntity (process) — дедуп по (tenantId, name)', async () => {
    // 1. upsertEntity({ type:'process', data:{ name:'Onboarding' } }) → created=true.
    // 2. Повторный вызов с тем же name → created=false, id совпадает.
    // 3. В AGE — ровно один узел :process.
    expect.fail('требует AGE-контейнер, см. infra/postgres');
  });

  it('upsertEntity (mission|vision|strategy) бросает BadRequest без EXTRACTION_ENABLE_TOP_LEVEL', async () => {
    // 1. upsertEntity({ type:'mission', data:{...} }) → BadRequestException.
    expect.fail('требует AGE-контейнер, см. infra/postgres');
  });
});
