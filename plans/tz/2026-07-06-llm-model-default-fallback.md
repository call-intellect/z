---
feature: llm-model-default-fallback
architecture: plans/architecture/2026-07-06-llm-model-default-fallback.md
status: done
date: 2026-07-06
---

# ТЗ — модель по умолчанию (защита при удалении LlmModel)

## REALITY-CHECK

- `LlmProvider.defaultModelKey String?` — уже есть, свободная строка (не FK на `LlmModel`), сегодня редактируется только через `PATCH /admin/llm-providers/:id` (форма провайдера). Переиспользуем как «дефолтная модель провайдера».
- `LlmModel` — НЕТ поля is-default. НЕ добавляем.
- `AdminLlmModelsService.softDelete(id)` (`backend/src/modules/admin/economics/admin-llm-models.service.ts:109`) — сегодня без всякой проверки использования. Заменяется на `softDeleteWithFallback`.
- `LlmTaskRoute.model String?` — модель маршрута, независимая строка (tier-нормализованные записи). Legacy JSON (`providers: Json?`, tier=null) — массив `{provider, model?}`.
- `LlmTaskRouteChange.changeType String` — НЕ enum, просто строка с задокументированной конвенцией. Новое значение `model_deleted_auto_migrated` не требует миграции.
- Нет спеки для `AdminLlmModelsService` — пишем с нуля (моки `PrismaService`/`ProviderInfoResolver`/`LlmRouterService`, по образцу `admin-llm-providers.service.spec.ts`).
- `AdminLlmModelsController` (`admin-llm-models.controller.ts`) — `@Delete(':id')` сегодня без `@Body`/`@CurrentUser()`. Добавляем оба.
- Никакой Prisma-миграции не требуется (проверено выше).

## Фаза 1 — бэкенд: preview + set-default + миграция маршрутов

**`backend/src/modules/admin/economics/admin-llm-models.service.ts`:**

Конструктор — добавить `@Optional() @Inject(ProviderInfoResolver) providerInfo?` (инвалидация кэша при смене `defaultModelKey`) и `@Optional() @Inject(LlmRouterService) router?` (тот же паттерн, что у `AdminLlmProvidersService`).

```ts
async setDefaultModel(id: string): Promise<{ ok: true }> {
  const row = await this.getById(id); // includes provider
  if (!row.isActive) {
    throw new UnprocessableEntityException({
      ok: false,
      error: { code: 'default_model_inactive', message: `Модель "${row.modelKey}" неактивна — сначала активируйте` },
    });
  }
  await this.prisma.llmProvider.update({
    where: { id: row.providerId },
    data: { defaultModelKey: row.modelKey },
  });
  this.providerInfo?.invalidate();
  return { ok: true };
}

async previewRemoval(id: string): Promise<{
  modelKey: string; providerName: string; isDefault: boolean;
  affectedRoutesCount: number; affectedTenantsCount: number;
  inDefaultChain: boolean; currentDefaultModel: string | null;
}> {
  const row = await this.getById(id);
  const providerName = row.provider.name;
  const [tieredRoutes, legacyRoutes] = await Promise.all([
    this.prisma.llmTaskRoute.findMany({
      where: { providerName, model: row.modelKey, tier: { not: null } },
      select: { tenantId: true },
    }),
    this.prisma.llmTaskRoute.findMany({
      where: { tier: null, providers: { not: Prisma.JsonNull } },
      select: { tenantId: true, providers: true },
    }),
  ]);
  const legacyMatches = legacyRoutes.filter((r) =>
    Array.isArray(r.providers) &&
    (r.providers as Array<{ provider?: string; model?: string }>).some(
      (p) => p?.provider === providerName && p?.model === row.modelKey,
    ),
  );
  const affectedRoutesCount = tieredRoutes.length + legacyMatches.length;
  const tenantSet = new Set([...tieredRoutes, ...legacyMatches].map((r) => r.tenantId ?? '__global__'));
  const chain = await this.cfg?.getDynamic<Array<{ provider: string; model?: string }>>(
    'llm.router.defaultChain', undefined, [],
  ).catch(() => []);
  const inDefaultChain = Array.isArray(chain) &&
    chain.some((e) => e?.provider === providerName && e?.model === row.modelKey);
  const currentDefaultModel = row.provider.defaultModelKey;
  return {
    modelKey: row.modelKey,
    providerName,
    isDefault: currentDefaultModel === row.modelKey,
    affectedRoutesCount,
    affectedTenantsCount: tenantSet.size,
    inDefaultChain,
    currentDefaultModel: currentDefaultModel !== row.modelKey ? currentDefaultModel : null,
  };
}

async softDeleteWithFallback(
  id: string,
  reassignDefaultModelTo: string | undefined,
  userId: string,
): Promise<{ ok: true; routesMigrated: number }> {
  const row = await this.getById(id);
  const providerName = row.provider.name;

  if (row.provider.defaultModelKey === row.modelKey) {
    if (!reassignDefaultModelTo) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'must_reassign_default_model',
          message: `"${row.modelKey}" — дефолтная модель провайдера "${providerName}". Сначала выбери новую дефолтную модель.`,
        },
      });
    }
    const replacement = await this.prisma.llmModel.findFirst({
      where: { providerId: row.providerId, modelKey: reassignDefaultModelTo, isActive: true, deletedAt: null },
    });
    if (!replacement) {
      throw new UnprocessableEntityException({
        ok: false,
        error: { code: 'default_model_invalid', message: `Модель "${reassignDefaultModelTo}" не найдена/не активна у провайдера "${providerName}"` },
      });
    }
    await this.prisma.llmProvider.update({
      where: { id: row.providerId },
      data: { defaultModelKey: reassignDefaultModelTo },
    });
    this.providerInfo?.invalidate();
  }

  const provider = await this.prisma.llmProvider.findUniqueOrThrow({ where: { id: row.providerId } });
  const defaultModelKey = provider.defaultModelKey;

  if (!defaultModelKey || defaultModelKey === row.modelKey) {
    await this.assertModelNotInUse(providerName, row.modelKey);
  } else {
    const routesMigrated = await this.migrateModelRoutesToDefault(providerName, row.modelKey, defaultModelKey, userId);
    await this.prisma.llmModel.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    this.providerInfo?.invalidate();
    await this.router?.refreshCache();
    return { ok: true, routesMigrated };
  }

  await this.prisma.llmModel.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  return { ok: true, routesMigrated: 0 };
}

private async assertModelNotInUse(providerName: string, modelKey: string): Promise<void> {
  const activeRoute = await this.prisma.llmTaskRoute.findFirst({
    where: { providerName, model: modelKey, isActive: true, tier: { not: null } },
    select: { taskType: true },
  });
  if (activeRoute) {
    throw new ConflictException({
      ok: false,
      error: {
        code: 'model_in_use_by_routes',
        message: `Модель "${modelKey}" провайдера "${providerName}" используется в активном маршруте taskType="${activeRoute.taskType}" — сначала уберите её из маршрутизации`,
      },
    });
  }
}

private async migrateModelRoutesToDefault(
  providerName: string, oldModelKey: string, newModelKey: string, userId: string,
): Promise<number> {
  return this.prisma.$transaction(async (tx) => {
    let migratedCount = 0;
    const tieredRoutes = await tx.llmTaskRoute.findMany({
      where: { providerName, model: oldModelKey, tier: { not: null } },
    });
    for (const route of tieredRoutes) {
      await tx.llmTaskRoute.update({ where: { id: route.id }, data: { model: newModelKey } });
      await tx.llmTaskRouteChange.create({
        data: {
          taskType: route.taskType, tenantId: route.tenantId, tier: route.tier,
          changeType: 'model_deleted_auto_migrated',
          before: { providerName, model: oldModelKey } as unknown as Prisma.InputJsonValue,
          after: { providerName, model: newModelKey } as unknown as Prisma.InputJsonValue,
          changedById: userId, reason: 'model_deleted_auto_migrated',
        },
      });
      migratedCount += 1;
    }

    const legacyRoutes = await tx.llmTaskRoute.findMany({ where: { tier: null, providers: { not: Prisma.JsonNull } } });
    for (const route of legacyRoutes) {
      const providers = Array.isArray(route.providers)
        ? (route.providers as unknown as Array<{ provider: string; model?: string }>) : [];
      if (!providers.some((p) => p?.provider === providerName && p?.model === oldModelKey)) continue;
      const before = providers;
      const replaced = providers.map((p) =>
        p?.provider === providerName && p?.model === oldModelKey ? { provider: providerName, model: newModelKey } : p,
      );
      const deduped = dedupeByProviderModel(replaced);
      await tx.llmTaskRoute.update({ where: { id: route.id }, data: { providers: deduped as unknown as Prisma.InputJsonValue } });
      await tx.llmTaskRouteChange.create({
        data: {
          taskType: route.taskType, tenantId: route.tenantId, tier: null,
          changeType: 'model_deleted_auto_migrated',
          before: before as unknown as Prisma.InputJsonValue,
          after: deduped as unknown as Prisma.InputJsonValue,
          changedById: userId, reason: 'model_deleted_auto_migrated',
        },
      });
      migratedCount += 1;
    }
    return migratedCount;
  });
}
```

module-scope helper (аналог `dedupeByProvider`, но ключ — `provider::model`):
```ts
function dedupeByProviderModel<T extends { provider?: string; model?: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.provider ?? ''}::${e.model ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

`getById` уже возвращает `{...row, provider}` (include provider) — переиспользуем как есть, тип `row.provider.defaultModelKey`/`row.provider.name` доступны.

`list()` — добавить в маппинг `isDefault: m.modelKey === m.provider.defaultModelKey` (provider уже заджойнен).

**Контроллер** (`admin-llm-models.controller.ts`):
- `GET :id/removal-impact` → `previewRemoval`
- `POST :id/set-default` → `setDefaultModel`
- `@Delete(':id')` → `@Body(RemoveModelSchema) dto, @CurrentUser() user` → `softDeleteWithFallback(id, dto.reassignDefaultModelTo, user.id)`

**DTO** (`dto/admin-llm-models.dto.ts`):
```ts
export const RemoveModelSchema = z.object({ reassignDefaultModelTo: z.string().min(1).optional() });
export type RemoveModelDto = z.infer<typeof RemoveModelSchema>;
```

**Приёмка Фазы 1:** `bun run typecheck`, `bun run lint`, новый spec-файл `admin-llm-models.service.spec.ts` покрывает: preview (пусто/занято/дефолт), set-default (успех/неактивная модель), softDeleteWithFallback (a) не дефолт+не используется→удаляет, б) не дефолт+используется+нет дефолта провайдера→блок, в) не дефолт+используется+есть дефолт→мигрирует tier-маршруты, г) legacy JSON миграция+дедуп, д) дефолт без reassign→блок must_reassign, е) дефолт+reassign на невалидную модель→422, ж) дефолт+валидный reassign→переключает `defaultModelKey` и (если сама модель ещё где-то используется по старому modelKey) мигрирует маршруты на новую.

## Фаза 2 — фронтенд

**`frontend/src/domain/admin-llm-model.ts`**: добавить `isDefault: boolean` в `AdminLlmModelApi`/`Domain` + маппер; добавить тип `ModelRemovalImpactApi`.

**`frontend/src/api/admin-llm-models.api.ts`**: `previewRemoval(id)`, `setDefault(id)`, `remove(id, reassignDefaultModelTo?)` (DELETE с телом через `apiClient.del(path, {body})`).

**`frontend/app/(admin)/admin/ai/catalog/LlmModelsClient.tsx`**:
- Бейдж `★ По умолчанию` в `ModelsTable` рядом с статусом, если `m.isDefault`.
- Кнопка «Сделать по умолчанию» (если не дефолт) рядом с «Изменить»/«Удалить».
- `handleDelete`: если `m.isDefault` → диалог `ReassignDefaultModelDialog` (выбор новой дефолтной модели ТОГО ЖЕ провайдера из активных моделей, `providerId=m.providerId` фильтр) → `remove(id, {reassignDefaultModelTo})`.
- Иначе → `previewRemoval` → если occupied && currentDefaultModel есть → диалог предупреждения (аналог `removalDialog` у провайдеров) → confirm → `remove(id)` без reassign.
- Иначе occupied && НЕТ currentDefaultModel → `toast.error` с пояснением «сначала назначь дефолтную модель у другой модели этого провайдера» (аналог фикса в `LlmProvidersClient`).
- Иначе — простой `window.confirm` → `remove(id)`.

**Приёмка Фазы 2:** `bun run typecheck`, `bun run lint`, `bun run build` (frontend), ручная проверка в браузере (создать 2 модели у одного провайдера, назначить дефолт, удалить занятую — маршруты переключаются; удалить дефолтную — просит reassign).

## Итог
- [x] Фаза 1 — бэкенд (сервис, контроллер, DTO, тесты) — 13 новых тестов, 253/253 в модуле economics
- [x] Фаза 2 — фронтенд (badge, кнопка, диалоги) — typecheck/lint/build чистые

Живая browser-QA (Playwright, реальная локальная БД): провайдерский фикс (occupied+no-default → понятный toast вместо голой ошибки; occupied+default → диалог миграции → DELETE мигрировал 191 маршрут с `deepseek` на `openai-via-proxy`) и модельная фича (бейдж «По умолчанию» подхватил уже существующие `defaultModelKey` у kie/grsai; удаление не занятой модели → простой confirm; удаление дефолтной модели `gpt-4o` без reassign → диалог → выбор `gpt-4o-mini` → DELETE 200, дефолт переехал) — оба сценария пройдены полностью, без правок по итогам QA.
