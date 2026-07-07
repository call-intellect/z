import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createPrismaClient } from '../_lib/prisma';

import {
  ARTIFACTS_DIR,
  assertNotProd,
  BEARER_BY_KEY,
  type CloneKey,
  log,
  type OwnedRule,
  type RegulationKind,
  requireOrg,
  ROLE_BY_KEY,
} from './_shared';

interface RawRule {
  kind: RegulationKind;
  id: string;
  name: string;
  text: string;
  scope: string | null;
  ownerPersonId: string | null;
  ownerRoleId: string | null;
  forRole: string | null;
}

interface RoleInfo {
  key: CloneKey;
  roleName: string;
  bearerName: string;
  roleId: string | null;
  personId: string | null;
  departmentId: string | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function scopeRoleSuffix(scope: string | null): string | null {
  const t = (scope ?? '').trim();
  if (!t.toLowerCase().startsWith('role:')) return null;
  return t.slice('role:'.length).trim();
}

function ruleBelongsToRole(r: RawRule, role: RoleInfo): { owned: boolean; via: string } {
  if (role.roleId && r.ownerRoleId && r.ownerRoleId === role.roleId) return { owned: true, via: 'ownerRoleId' };
  const suffix = scopeRoleSuffix(r.scope);
  if (suffix) {
    if (role.roleId && suffix === role.roleId) return { owned: true, via: 'scope:role-id' };
    if (norm(suffix) === norm(role.roleName)) return { owned: true, via: 'scope:role-name' };
    if (role.bearerName && norm(suffix) === norm(role.bearerName)) return { owned: true, via: 'scope:bearer-name' };
  }
  if (r.forRole) {
    if (role.roleId && r.forRole === role.roleId) return { owned: true, via: 'forRole:id' };
    if (norm(r.forRole) === norm(role.roleName)) return { owned: true, via: 'forRole:name' };
    if (role.bearerName && norm(r.forRole) === norm(role.bearerName)) return { owned: true, via: 'forRole:bearer' };
  }
  if (role.personId && r.ownerPersonId && r.ownerPersonId === role.personId)
    return { owned: true, via: 'ownerPersonId' };
  return { owned: false, via: '' };
}

function scopeBucket(scope: string | null, knownRoleIds: Set<string>): string {
  const t = (scope ?? '').trim();
  if (!t) return 'ПУСТО';
  if (t === 'org') return 'org';
  if (t.toLowerCase().startsWith('department:')) return 'department:*';
  const suffix = scopeRoleSuffix(t);
  if (suffix) return knownRoleIds.has(suffix) ? 'role:<cuid>' : 'role:<ИМЯ/иное>';
  return `иное(${t.slice(0, 20)})`;
}

async function main(): Promise<void> {
  assertNotProd();
  const orgId = requireOrg();
  const prisma = createPrismaClient();
  try {
    const roles = await prisma.role.findMany({
      where: { tenantId: orgId, deletedAt: null },
      select: { id: true, name: true, departmentId: true },
    });
    const knownRoleIds = new Set(roles.map((r) => r.id));

    const targets: RoleInfo[] = [];
    for (const key of Object.keys(ROLE_BY_KEY) as CloneKey[]) {
      const role = roles.find((r) => norm(r.name) === norm(ROLE_BY_KEY[key])) ?? null;
      const person = await prisma.person.findFirst({
        where: { tenantId: orgId, name: BEARER_BY_KEY[key], deletedAt: null },
        select: { id: true },
      });
      targets.push({
        key,
        roleName: ROLE_BY_KEY[key],
        bearerName: BEARER_BY_KEY[key],
        roleId: role?.id ?? null,
        personId: person?.id ?? null,
        departmentId: role?.departmentId ?? null,
      });
    }

    const baseWhere = { tenantId: orgId, deletedAt: null, status: 'active' as const };
    const [regs, instrs, pols, procs] = await Promise.all([
      prisma.regulation.findMany({
        where: baseWhere,
        select: { id: true, name: true, statement: true, contentMd: true, scope: true, ownerPersonId: true },
      }),
      prisma.instruction.findMany({
        where: baseWhere,
        select: {
          id: true,
          name: true,
          statement: true,
          contentMd: true,
          scope: true,
          ownerPersonId: true,
          forRole: true,
        },
      }),
      prisma.policy.findMany({
        where: baseWhere,
        select: { id: true, name: true, contentMd: true, scope: true, ownerPersonId: true },
      }),
      prisma.process.findMany({
        where: baseWhere,
        select: { id: true, name: true, description: true, scope: true, ownerPersonId: true, ownerRoleId: true },
      }),
    ]);

    const longer = (a: string | null, b: string | null): string => {
      const x = (a ?? '').trim();
      const y = (b ?? '').trim();
      return (x.length >= y.length ? x : y).slice(0, 4000);
    };
    const all: RawRule[] = [
      ...regs.map((r) => ({
        kind: 'regulation' as const,
        id: r.id,
        name: r.name,
        text: longer(r.statement, r.contentMd),
        scope: r.scope,
        ownerPersonId: r.ownerPersonId,
        ownerRoleId: null,
        forRole: null,
      })),
      ...instrs.map((r) => ({
        kind: 'instruction' as const,
        id: r.id,
        name: r.name,
        text: longer(r.statement, r.contentMd),
        scope: r.scope,
        ownerPersonId: r.ownerPersonId,
        ownerRoleId: null,
        forRole: r.forRole,
      })),
      ...pols.map((r) => ({
        kind: 'policy' as const,
        id: r.id,
        name: r.name,
        text: (r.contentMd ?? '').trim().slice(0, 4000),
        scope: r.scope,
        ownerPersonId: r.ownerPersonId,
        ownerRoleId: null,
        forRole: null,
      })),
      ...procs.map((r) => ({
        kind: 'process' as const,
        id: r.id,
        name: r.name,
        text: (r.description ?? '').trim().slice(0, 4000),
        scope: r.scope,
        ownerPersonId: r.ownerPersonId,
        ownerRoleId: r.ownerRoleId,
        forRole: null,
      })),
    ];

    log(`\n=== СТРЕЛА ownership dump (org ${orgId}) ===`);
    log(`Роли (${roles.length}): ${roles.map((r) => `${r.name}${knownRoleIds.has(r.id) ? '' : ''}`).join(' | ')}`);
    log(
      `Целевые роли: ${targets
        .map((t) => `${t.roleName}[role:${t.roleId ? 'OK' : 'НЕТ'} person:${t.personId ? 'OK' : 'НЕТ'} dept:${t.departmentId ?? '-'}]`)
        .join('\n               ')}`,
    );

    log(`\n=== Раскладка scope по таблицам (active, не удалённые) ===`);
    for (const kind of ['regulation', 'instruction', 'policy', 'process'] as RegulationKind[]) {
      const rows = all.filter((r) => r.kind === kind);
      const buckets = new Map<string, number>();
      for (const r of rows) {
        const b = scopeBucket(r.scope, knownRoleIds);
        buckets.set(b, (buckets.get(b) ?? 0) + 1);
      }
      const owners = rows.filter((r) => r.ownerPersonId).length;
      const ownerRoles = rows.filter((r) => r.ownerRoleId).length;
      const forRoles = rows.filter((r) => r.forRole).length;
      log(
        `  ${kind.padEnd(12)} всего=${rows.length}  ownerPersonId=${owners}  ownerRoleId=${ownerRoles}  forRole=${forRoles}`,
      );
      const bstr = [...buckets.entries()].map(([k, v]) => `${k}:${v}`).join('  ');
      log(`               scope → ${bstr}`);
    }

    log(`\n=== Owned-набор по ролям (read-time резолв: ownerRoleId|scope-cuid|scope-name|forRole|ownerPersonId) ===`);
    const ownedByRole: Record<string, OwnedRule[]> = {};
    for (const t of targets) {
      const owned: OwnedRule[] = [];
      const viaCount = new Map<string, number>();
      for (const r of all) {
        const res = ruleBelongsToRole(r, t);
        if (res.owned) {
          owned.push({
            kind: r.kind,
            id: r.id,
            name: r.name,
            text: r.text,
            scope: r.scope,
            ownerPersonId: r.ownerPersonId,
            ownerRoleId: r.ownerRoleId,
            forRole: r.forRole,
            ownedBy: res.via,
          });
          viaCount.set(res.via, (viaCount.get(res.via) ?? 0) + 1);
        }
      }
      ownedByRole[t.key] = owned;
      const byKind = new Map<string, number>();
      for (const o of owned) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
      log(
        `\n  [${t.roleName}] owned=${owned.length}  (${[...byKind.entries()].map(([k, v]) => `${k}:${v}`).join(' ')})`,
      );
      log(`     via: ${[...viaCount.entries()].map(([k, v]) => `${k}:${v}`).join('  ') || '(нет)'}`);
      for (const o of owned.slice(0, 40)) {
        log(`       - (${o.kind}) ${o.name}  [${o.ownedBy}]  «${o.text.replace(/\s+/g, ' ').slice(0, 90)}»`);
      }
      if (owned.length > 40) log(`       … +${owned.length - 40}`);
    }

    const orphans = all.filter((r) => {
      const anyOwned = targets.some((t) => ruleBelongsToRole(r, t).owned);
      const shared = r.scope === 'org' || (r.scope ?? '').startsWith('department:');
      return !anyOwned && !shared;
    });
    log(`\n=== Бесхозные (никакой роли, не org/dept): ${orphans.length} ===`);
    const orphanByKind = new Map<string, number>();
    for (const o of orphans) orphanByKind.set(o.kind, (orphanByKind.get(o.kind) ?? 0) + 1);
    log(`   ${[...orphanByKind.entries()].map(([k, v]) => `${k}:${v}`).join('  ')}`);

    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const out = resolve(ARTIFACTS_DIR, 'ownership.json');
    writeFileSync(
      out,
      JSON.stringify(
        {
          orgId,
          generatedAt: new Date().toISOString(),
          targets,
          ownedByRole,
          orphanCount: orphans.length,
          counts: { regulation: regs.length, instruction: instrs.length, policy: pols.length, process: procs.length },
        },
        null,
        2,
      ),
      'utf8',
    );
    log(`\n✓ ownership → ${out}`);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    process.stderr.write(`explore FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
