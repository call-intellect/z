import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AdminPromptTemplatesService, SECTIONS_MAX_TOKENS_SUM } from './prompt-templates.service';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

interface TemplateRow {
  id: string;
  scope: 'system' | 'org';
  orgId: string | null;
  key: string;
  name: string;
  description?: string | null;
  meetingType?: string | null;
  taskType: string;
  status: 'draft' | 'active' | 'archived';
  activeVersionId: string | null;
  editedByAdmin: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface VersionRow {
  id: string;
  templateId: string;
  versionNumber: number;
  systemPrompt: string;
  outputSchema: unknown;
  toolName: string | null;
  createdById: string;
  createdAt: Date;
  notes: string | null;
}

interface SectionRow {
  id: string;
  versionId: string;
  order: number;
  key: string;
  title: string;
  instruction: string;
  outputType: string;
  required: boolean;
  maxTokens: number | null;
}

function buildPrismaMock() {
  const templates: TemplateRow[] = [];
  const versions: VersionRow[] = [];
  const sections: SectionRow[] = [];
  let nextId = 1;

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'OR') continue;
      if (v === null) {
        if (row[k] !== null && row[k] !== undefined) return false;
        continue;
      }
      if (typeof v === 'object' && v !== null && 'contains' in v) continue;
      if (row[k] !== v) return false;
    }
    return true;
  };

  const prisma = {
    promptTemplate: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
        templates.filter((t) => (where ? matches(t as never, where) : true)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          templates.find((t) => matches(t as never, where)) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          templates.find((t) => t.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: TemplateRow = {
          id: `t-${nextId++}`,
          scope: data['scope'] as 'system' | 'org',
          orgId: (data['orgId'] as string | null | undefined) ?? null,
          key: data['key'] as string,
          name: data['name'] as string,
          description: (data['description'] as string | null | undefined) ?? null,
          meetingType: (data['meetingType'] as string | null | undefined) ?? null,
          taskType: data['taskType'] as string,
          status: (data['status'] as TemplateRow['status']) ?? 'draft',
          activeVersionId: null,
          editedByAdmin: Boolean(data['editedByAdmin']),
          createdById: data['createdById'] as string,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        templates.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const idx = templates.findIndex((t) => t.id === where.id);
          if (idx >= 0) {
            templates[idx] = { ...templates[idx]!, ...(data as Partial<TemplateRow>) };
            return templates[idx];
          }
          throw new Error('not found');
        },
      ),
    },
    promptTemplateVersion: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          versions.find((v) => matches(v as never, where)) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          versions.find((v) => v.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: VersionRow = {
          id: `v-${nextId++}`,
          templateId: data['templateId'] as string,
          versionNumber: data['versionNumber'] as number,
          systemPrompt: data['systemPrompt'] as string,
          outputSchema: data['outputSchema'],
          toolName: (data['toolName'] as string | null | undefined) ?? null,
          createdById: data['createdById'] as string,
          createdAt: new Date(),
          notes: (data['notes'] as string | null | undefined) ?? null,
        };
        versions.push(row);
        return row;
      }),
    },
    promptTemplateSection: {
      createMany: vi.fn(async ({ data }: { data: SectionRow[] }) => {
        for (const s of data) {
          sections.push({ ...s, id: `s-${nextId++}` });
        }
        return { count: data.length };
      }),
    },
    $transaction: vi.fn(async (cb: (tx: Tx) => unknown) => cb(prisma as unknown as Tx)),
  };

  const originalTemplateFindUnique = prisma.promptTemplate.findUnique;
  prisma.promptTemplate.findUnique = vi.fn(async (args: { where: { id: string } }) => {
    const row = await originalTemplateFindUnique(args);
    if (!row) return null;
    const tplVersions = versions.filter((v) => v.templateId === row.id);
    const active = row.activeVersionId ? versions.find((v) => v.id === row.activeVersionId) : null;
    return {
      ...row,
      versions: tplVersions,
      activeVersion: active
        ? {
            ...active,
            sections: sections.filter((s) => s.versionId === active.id),
          }
        : null,
    };
  }) as never;

  return { prisma, templates, versions, sections };
}

function makeSvc() {
  const { prisma, templates, versions, sections } = buildPrismaMock();
  const svc = new AdminPromptTemplatesService(prisma as unknown as PrismaService);
  return { svc, prisma, templates, versions, sections };
}

describe('AdminPromptTemplatesService', () => {
  it('create — scope=org без orgId → BadRequest', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.create(
        {
          scope: 'org',
          key: 'k',
          name: 'Имя',
          taskType: 'summary',
        } as never,
        'u-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'org_id_required_for_scope_org' }),
      }),
    });
  });

  it('create — system шаблон создаётся без orgId, без начальной версии', async () => {
    const { svc, templates } = makeSvc();
    const out = await svc.create(
      {
        scope: 'system',
        key: 'type-test',
        name: 'Тестовый шаблон',
        taskType: 'summary',
      } as never,
      'u-1',
    );
    expect(out.scope).toBe('system');
    expect(out.orgId).toBeNull();
    expect(out.status).toBe('draft');
    expect(templates.length).toBe(1);
  });

  it('create — дубликат key в Org → BadRequest', async () => {
    const { svc } = makeSvc();
    await svc.create(
      {
        scope: 'org',
        orgId: 'org-1',
        key: 'my-template',
        name: 'Один',
        taskType: 'summary',
      } as never,
      'u-1',
    );
    await expect(
      svc.create(
        {
          scope: 'org',
          orgId: 'org-1',
          key: 'my-template',
          name: 'Дубль',
          taskType: 'summary',
        } as never,
        'u-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'prompt_template_key_already_exists' }),
      }),
    });
  });

  it('createVersion — сумма maxTokens > 16000 → BadRequest', async () => {
    const { svc } = makeSvc();
    const tpl = await svc.create(
      {
        scope: 'system',
        key: 'type-big',
        name: 'Большой',
        taskType: 'summary',
      } as never,
      'u-1',
    );
    const sections = Array.from({ length: 5 }).map((_, i) => ({
      key: `sec_${i}`,
      title: `Секция ${i}`,
      instruction: 'Инструкция длиннее десяти символов.',
      outputType: 'text' as const,
      required: true,
      maxTokens: Math.ceil(SECTIONS_MAX_TOKENS_SUM / 4) + 100,
    }));
    await expect(
      svc.createVersion(
        tpl.id,
        {
          systemPrompt: 'Базовый промпт.',
          sections,
        } as never,
        'u-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'sections_max_tokens_exceeded' }),
      }),
    });
  });

  it('createVersion — успешно создаёт версию 2, не активирует автоматически', async () => {
    const { svc } = makeSvc();
    const tpl = await svc.create(
      {
        scope: 'system',
        key: 'type-ok',
        name: 'Тест',
        taskType: 'summary',
      } as never,
      'u-1',
    );
    const out = await svc.createVersion(
      tpl.id,
      {
        systemPrompt: 'Сис-промпт.',
        sections: [
          {
            key: 'summary',
            title: 'Сводка',
            instruction: 'Опиши главное.',
            outputType: 'text',
            required: true,
          },
        ],
      } as never,
      'u-1',
    );
    expect(out.version.versionNumber).toBe(1);
    expect(out.activated).toBe(false);
  });

  it('softDelete — system-шаблон бросает 403', async () => {
    const { svc } = makeSvc();
    const tpl = await svc.create(
      {
        scope: 'system',
        key: 'type-system',
        name: 'Системный',
        taskType: 'summary',
      } as never,
      'u-1',
    );
    await expect(svc.softDelete(tpl.id, 'u-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'cannot_delete_system_template' }),
      }),
    });
  });

  it('softDelete — Org-шаблон удаляется', async () => {
    const { svc, templates } = makeSvc();
    const tpl = await svc.create(
      {
        scope: 'org',
        orgId: 'org-1',
        key: 'mine',
        name: 'Мой',
        taskType: 'summary',
      } as never,
      'u-1',
    );
    const res = await svc.softDelete(tpl.id, 'u-1');
    expect(res.ok).toBe(true);
    const row = templates.find((t) => t.id === tpl.id);
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.status).toBe('archived');
  });

  it('activateVersion — обновляет activeVersionId и status=active', async () => {
    const { svc, templates } = makeSvc();
    const tpl = await svc.create(
      {
        scope: 'system',
        key: 'type-act',
        name: 'Активир',
        taskType: 'summary',
      } as never,
      'u-1',
    );
    const v = await svc.createVersion(
      tpl.id,
      {
        systemPrompt: 'промпт',
        sections: [
          {
            key: 's',
            title: 'Главное',
            instruction: 'Опиши главное.',
            outputType: 'text',
            required: true,
          },
        ],
      } as never,
      'u-1',
    );
    await svc.activateVersion(tpl.id, v.version.id);
    const row = templates.find((t) => t.id === tpl.id);
    expect(row?.activeVersionId).toBe(v.version.id);
    expect(row?.status).toBe('active');
  });
});
