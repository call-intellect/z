---
type: tz
status: ready-to-implement
feature: llm-provider-default-fallback
date: 2026-07-06
owner: Tozix
relates_to:
  - plans/architecture/2026-07-06-llm-provider-default-fallback.md
  - plans/tz/2026-07-02-llm-providers-models-routing-admin.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-07-06-llm-provider-default-fallback.md` · Статус согласования: одобрено 2026-07-06.

# ТЗ «Провайдер по умолчанию» (llm-provider-default-fallback)

## Принцип

Точный контракт, не пожелание. `path:line` — на момент написания (2026-07-06), перечитай перед правкой. Прочитай `nestjs-rules`, `prisma-db-push-rules`, `strict-production-review-gate` перед стартом.

**ВАЖНО про Prisma: этой фиче НУЖНА реальная миграция** (новая колонка). Инвариант из шаблона tz-author «только prisma:push, никогда migrate» — устарел: с 2026-06-05 в проекте версионируемые миграции (`CLAUDE.md`, skill `prisma-db-push-rules`). Используй `bun run prisma:migrate -- --name add-llm-provider-is-default`, НЕ `db push`.

**Вне scope / отложено:** не создаём поддержку нескольких дефолтов; не трогаем неактивные/невостребованные провайдеры (сегодня удаляются свободно); не переписываем tier-fallback-на-ошибках в `LlmRouterService.call()` — это разовая миграция данных МАРШРУТОВ в момент удаления провайдера из каталога, не рантайм-логика диспетчеризации.

## Цель + Зачем

Владелец хочет иметь возможность оставить в каталоге только одного ИИ-провайдера, убрав остальных — но сегодня удаление провайдера, занятого хоть в одном маршруте (а их ~250 задач), блокируется голой ошибкой 409 без объяснения что делать. Добавляем «провайдера по умолчанию»: при удалении любого ДРУГОГО занятого провайдера система вместо отказа сама переключает все занятые места на дефолт и показывает это владельцу перед подтверждением.

## REALITY-CHECK

1. **Блокировка удаления** — `backend/src/modules/admin/economics/admin-llm-providers.service.ts::assertProviderNotInUse()` (строки 162-191), вызывается из `softDelete()` (110) и `update()` (78-82, только при `isActive:false`). Бросает `ConflictException` `provider_in_use_by_routes` если провайдер (а) есть в `LlmTaskRoute` с `tenantId: null, isActive: true, tier: { not: null }` (`prisma.llmTaskRoute.findFirst`, строки 163-166) — **проверяет ТОЛЬКО глобальные тир-нормализованные маршруты**, НЕ смотрит ни на per-tenant (`tenantId` задан) маршруты, ни на legacy JSON-записи (`tier: null`, `providers: Json?`); либо (б) присутствует в `llm.router.defaultChain` (AdminSetting, JSON-массив `{provider, model}[]`, строки 176-190).
2. **`LlmProvider`** (`backend/prisma/schema.prisma:3104-3153`) — `name` уникален, один из 7 фиксированных слагов (`anthropic`/`minimax`/`openai-via-proxy`/`deepseek`/`ollama`/`kie`/`grsai`, тип `LlmProviderName` в `backend/src/modules/ai/services/llm-router.service.ts`). Уже есть `defaultModelKey String?` (строка ~3134, «модель по умолчанию для ЭТОГО провайдера, если вызов/маршрут её не задал») — **переиспользуем как модель дефолт-провайдера**, отдельного поля под модель заводить не нужно. Новой колонки под сам факт «это глобальный дефолт» сегодня НЕТ.
3. **`LlmTaskRoute`** (`schema.prisma:2109-2174`) — по (`taskType`, `tenantId`, `tier`, `providerName`) с `@@unique([taskType, tenantId, tier, providerName], name: "task_tenant_tier_provider_unique")`. `tenantId: null` = глобальный, задан = per-org override. Модерные записи — `tier` НЕ NULL (`'primary'|'secondary'|'tertiary'`, enum `LlmRouteTier`), legacy — `tier: null` + `providers: Json?` (массив `{provider, model?}`). **Оба формата нужно проверять и мигрировать** — legacy-формат используется, пока для (taskType, tenantId) нет ни одной тир-нормализованной записи (см. комментарий строки 2116-2120).
4. **`LlmTaskRouteChange`** (`schema.prisma:2176-2203`) — уже существующий audit-log переключений маршрутов, `changeType` уже включает `'removed_provider'` (используется в `AiModelsService.removeProvider()`, `backend/src/modules/admin/ai-models/ai-models.service.ts:303-339`). Есть готовый пример: `before`/`after` (`Json`), `changedById`, `reason`, `tenantId` (сегодня везде `null` — писатель не поддерживает per-tenant audit, см. п.5).
5. **`AiModelsService.writeAuditLog()`** (строки 673-694) — **приватный** метод ДРУГОГО сервиса, хардкодит `tenantId: null` в `llmTaskRouteChange.create`. НЕ инжектируй `AiModelsService` в `AdminLlmProvidersService` ради этого метода (лишняя межсервисная связь ради приватного метода) — пиши в `LlmTaskRouteChange` напрямую через уже инжектированный `PrismaService`, передавая реальный `tenantId` (не всегда `null` — при миграции per-tenant маршрутов).
6. **`AiModelsService.removeProvider()`/`putChain()`** (строки 303-424) — работают ОДИН taskType / ОДНА запись за раз, не bulk. Для этой фичи нужен НОВЫЙ bulk-метод (найти ВСЕ маршруты по всем taskType и обоим tenant-scope сразу), существующие методы НЕ покрывают этот сценарий — не пытайся их «расширить», пиши отдельно в `AdminLlmProvidersService`.
7. **Frontend** `frontend/app/(admin)/admin/ai/catalog/LlmProvidersClient.tsx` — карточка провайдера (строки ~280-337): плоский ряд кнопок Smoke / Активировать-Деактивировать / Редактировать / Удалить (НЕ dropdown-меню). `defaultModelKey` уже отображается (строки 301-305: `модель по умолчанию: {defaultModelKey}`). `handleDelete()` (161-181) — `window.confirm(...)` (голый нативный confirm) → `adminLlmProvidersApi.remove(p.id)` → `toast.error(e.message)` при ошибке — отсюда голый текст 409, который видел владелец.
8. **Контроллер** `admin-llm-providers.controller.ts` — база `api/v1/admin/llm-providers`, `@UseGuards(CookieAuthGuard, SuperAdminGuard)`, `@Delete(':id')` → `softDelete(id)` без body. Нужно расширить контракт удаления (см. Контракт-first §3).

## Принятые решения владельца (архитектура, не пересматривать)

| # | Решение | Источник |
|---|---|---|
| Р1 | Дефолт — ровно одна пара (provider, model) на платформу | Архитектура §7 Р1 |
| Р2 | Если дефолт после подстановки оказался бы дважды в одной цепочке (том же (taskType, tenantId)) — второе появление убирается, не дублируется | Архитектура §7 Р2 |
| Р3 | Если дефолт не назначен — поведение как сегодня (жёсткий отказ), ничего не подставляется молча | Архитектура §7 Р3 |
| Р4 | Подстановка дефолта затрагивает и глобальные, и per-org (`tenantId` задан) маршруты | Архитектура §7 Р4 |
| Р5 | Удаление самого дефолтного провайдера — один диалог «выбери нового дефолта и удали», не блокировка | Архитектура §7 Р5 |

## Доказательство выбора

**Развилка: где хранить «это дефолт» и как гарантировать «ровно один».**

| Критерий | A — новая колонка `LlmProvider.isDefaultProvider Boolean` + проверка «сбросить старый/поставить новый» в транзакции сервиса | B — новая отдельная AdminSetting-крутилка `llm.router.defaultProviderName` (аналог `llm.router.defaultChain`, но одна запись) |
|---|---|---|
| Единообразие с существующим `defaultModelKey` (тоже поле НА провайдере) | ✅ да — оба «свойства провайдера» лежат вместе | ❌ дефолт-статус хранится ОТДЕЛЬНО от провайдера, к которому относится |
| Гарантия «ровно один» | ✅ транзакция: `updateMany({isDefaultProvider:false})` + `update({id, isDefaultProvider:true})` — атомарно, без риска рассинхрона | ⚠️ строка настройки может «протухнуть», если провайдер с этим именем удалён в обход — нужна отдельная валидация при каждом чтении |
| Нужна ли Prisma-миграция | Да, аддитивная (1 колонка, дефолт `false`) — безопасно | Нет — но создаёт третий параллельный источник правды про провайдеров (name/defaultModelKey на LlmProvider + отдельная AdminSetting) |
| Переиспользование `defaultModelKey` для модели | ✅ прямое | ⚠️ пришлось бы дублировать модель в самой крутилке |

**Выбор: A.** Единообразнее (дефолт — это свойство провайдера, как и `defaultModelKey`), гарантия «ровно один» проще и надёжнее в транзакции БД, чем в JSON-настройке. Миграция — одна аддитивная колонка, минимальный риск.

## Scope

**Входит:**
- Новая колонка `LlmProvider.isDefaultProvider`, эндпоинт «назначить дефолтом».
- Эндпоинт «предпросмотр удаления» (сколько маршрутов затронуто, кто дефолт).
- Bulk-миграция маршрутов (global + per-tenant, tier-нормализованные + legacy JSON) при удалении занятого провайдера.
- Подстановка в `llm.router.defaultChain`, если провайдер там есть.
- Диалог «удалить и переключить» на фронте; отдельный диалог «выбери нового дефолта и удали» для случая удаления самого дефолта.
- Audit-лог (`LlmTaskRouteChange`, `changeType: 'removed_provider'`) на каждый мигрированный маршрут.

**Не входит:**
- Несколько дефолтов одновременно.
- Изменение `LlmRouterService.call()` / tier-fallback-на-ошибках.
- UI для просмотра `LlmTaskRouteChange`-истории специально под эту фичу (уже есть `history()`/`<TaskTypeDetailsCard/>` — не трогаем).

## Граничные контракты с другими ТЗ

- `plans/tz/2026-07-02-llm-providers-models-routing-admin.md` — родительская фича каталога; эта доработка расширяет `AdminLlmProvidersService`/`LlmProvidersClient.tsx`, не переписывает.
- `AiModelsService` (putChain/removeProvider/history) — НЕ трогать, НЕ инжектировать в `AdminLlmProvidersService` (см. REALITY-CHECK п.5-6). Новая логика — самодостаточна в `AdminLlmProvidersService` + прямая запись в `LlmTaskRouteChange` через `PrismaService`.

## Контракт-first

### 1. `backend/prisma/schema.prisma` — модель `LlmProvider`, добавить поле

```prisma
model LlmProvider {
  // ...существующие поля...
  /// Ф-фича 2026-07-06 llm-provider-default-fallback: ровно один провайдер в системе
  /// может быть isDefaultProvider=true — это «провайдер по умолчанию», на него
  /// автоматически переключаются маршруты при удалении других провайдеров.
  /// Модель дефолта — уже существующий defaultModelKey. Гарантия «ровно один или ноль» —
  /// на уровне сервиса (транзакция), не на уровне БД-constraint.
  isDefaultProvider Boolean @default(false)
}
```
Миграция: `cd backend && bun run prisma:migrate -- --name add-llm-provider-is-default` (аддитивная, `default(false)` — существующие строки не ломает). После — `bun run prisma:generate`.

### 2. `backend/src/modules/admin/economics/admin-llm-providers.service.ts` — новые методы

```ts
/**
 * Ф2026-07-06: назначить провайдера дефолтным. Атомарно снимает флаг
 * со старого дефолта (если был) и ставит на новый. model должен принадлежать
 * провайдеру и быть активным (LlmModel.providerId=id, isActive=true) —
 * иначе UnprocessableEntityException 'default_model_invalid'.
 */
async setDefaultProvider(id: string, model: string): Promise<{ ok: true }> {
  const row = await this.getRow(id);
  const modelRow = await this.prisma.llmModel.findFirst({
    where: { providerId: id, modelKey: model, isActive: true, deletedAt: null },
  });
  if (!modelRow) {
    throw new UnprocessableEntityException({
      ok: false,
      error: { code: 'default_model_invalid', message: `Модель "${model}" не найдена/не активна у провайдера "${row.name}"` },
    });
  }
  await this.prisma.$transaction([
    this.prisma.llmProvider.updateMany({ where: { isDefaultProvider: true }, data: { isDefaultProvider: false } }),
    this.prisma.llmProvider.update({ where: { id }, data: { isDefaultProvider: true, defaultModelKey: model } }),
  ]);
  this.providerInfo.invalidate();
  return { ok: true };
}

/**
 * Возвращает текущий дефолт (провайдер+модель) или null, если не назначен.
 */
private async getDefaultProvider(): Promise<{ providerName: string; model: string | null } | null> {
  const row = await this.prisma.llmProvider.findFirst({ where: { isDefaultProvider: true, deletedAt: null } });
  return row ? { providerName: row.name, model: row.defaultModelKey } : null;
}

/**
 * Ф2026-07-06: предпросмотр удаления — сколько маршрутов затронуто, текущий дефолт.
 * НЕ мутирует ничего.
 */
async previewRemoval(id: string): Promise<{
  providerName: string;
  isDefault: boolean;
  affectedRoutesCount: number;
  affectedTenantsCount: number;
  inDefaultChain: boolean;
  currentDefault: { providerName: string; model: string | null } | null;
}> {
  const row = await this.getRow(id);
  const [tieredRoutes, legacyRoutes] = await Promise.all([
    this.prisma.llmTaskRoute.findMany({
      where: { providerName: row.name, tier: { not: null } },
      select: { tenantId: true },
    }),
    this.prisma.llmTaskRoute.findMany({
      where: { tier: null, providers: { not: Prisma.JsonNull } },
      select: { tenantId: true, providers: true },
    }),
  ]);
  const legacyMatches = legacyRoutes.filter((r) =>
    Array.isArray(r.providers) && (r.providers as Array<{ provider?: string }>).some((p) => p?.provider === row.name),
  );
  const affectedRoutesCount = tieredRoutes.length + legacyMatches.length;
  const tenantSet = new Set([...tieredRoutes, ...legacyMatches].map((r) => r.tenantId ?? '__global__'));
  const defaultChainRaw = await this.cfg
    ?.getDynamic<Array<{ provider: string }>>('llm.router.defaultChain', undefined, [])
    .catch(() => []);
  const inDefaultChain = Array.isArray(defaultChainRaw) && defaultChainRaw.some((e) => e?.provider === row.name);
  return {
    providerName: row.name,
    isDefault: row.isDefaultProvider,
    affectedRoutesCount,
    affectedTenantsCount: tenantSet.size,
    inDefaultChain,
    currentDefault: await this.getDefaultProvider(),
  };
}
```
`[ASSUMPTION: точный тип поля providers в LlmTaskRoute — Json? — Prisma.JsonNull для where-фильтра "не null"; перепроверь на месте, что фильтр находит легаси-записи, а не роняет typecheck]`.

### 3. `backend/src/modules/admin/economics/dto/admin-llm-providers.dto.ts` — новые Zod-схемы

```ts
export const SetDefaultProviderSchema = z.object({
  model: z.string().trim().min(1),
});
export type SetDefaultProviderDto = z.infer<typeof SetDefaultProviderSchema>;

export const RemoveProviderSchema = z.object({
  // Обязателен ТОЛЬКО если удаляемый провайдер сейчас isDefaultProvider=true (Р5).
  reassignDefaultTo: z
    .object({ providerId: z.string().min(1), model: z.string().trim().min(1) })
    .optional(),
});
export type RemoveProviderDto = z.infer<typeof RemoveProviderSchema>;
```

### 4. Контроллер — новые/изменённые роуты (`admin-llm-providers.controller.ts`)

```ts
@Get(':id/removal-impact')
previewRemoval(@Param('id') id: string) {
  return this.svc.previewRemoval(id);
}

@Post(':id/set-default')
setDefault(
  @Param('id') id: string,
  @Body(new ZodValidationPipe(SetDefaultProviderSchema)) dto: SetDefaultProviderDto,
) {
  return this.svc.setDefaultProvider(id, dto.model);
}

@Delete(':id')
remove(
  @Param('id') id: string,
  @Body(new ZodValidationPipe(RemoveProviderSchema)) dto: RemoveProviderDto,
  @CurrentUser() user: CurrentUserPayload,
) {
  return this.svc.softDeleteWithFallback(id, dto.reassignDefaultTo, user.id);
}
```
`[ASSUMPTION: @Delete с @Body — NestJS поддерживает тело в DELETE-запросе технически (Express/Fastify это пропускают), но проверь, что фронтовый apiClient умеет слать body на DELETE (найди api-client.ts, убедись что delete() принимает body-параметр; если нет — либо расширь apiClient, либо смени на @Post(':id/remove'))]`.

### 5. `softDeleteWithFallback` — основная бизнес-логика

```ts
async softDeleteWithFallback(
  id: string,
  reassignDefaultTo: { providerId: string; model: string } | undefined,
  userId: string,
): Promise<{ ok: true; routesMigrated: number }> {
  const row = await this.getRow(id);

  if (row.isDefaultProvider) {
    if (!reassignDefaultTo) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'must_reassign_default',
          message: `"${row.name}" — провайдер по умолчанию. Сначала выбери нового дефолта.`,
        },
      });
    }
    await this.setDefaultProvider(reassignDefaultTo.providerId, reassignDefaultTo.model);
  }

  const defaultProvider = await this.getDefaultProvider();
  if (!defaultProvider) {
    // Р3 — дефолт не назначен, поведение как сегодня (жёсткий отказ).
    await this.assertProviderNotInUse(row.name);
  } else if (defaultProvider.providerName !== row.name) {
    // Есть дефолт (и это не сам удаляемый после reassign) — мигрируем вместо отказа.
    const routesMigrated = await this.migrateRoutesToDefault(row.name, defaultProvider, userId);
    await this.migrateDefaultChain(row.name, defaultProvider);
    await this.prisma.llmProvider.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    this.providerInfo.invalidate();
    return { ok: true, routesMigrated };
  }

  await this.prisma.llmProvider.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  this.providerInfo.invalidate();
  return { ok: true, routesMigrated: 0 };
}
```

`migrateRoutesToDefault(oldProviderName, defaultProvider, userId)` — по одному (taskType, tenantId) за раз в транзакции:
1. Найти все тир-нормализованные `LlmTaskRoute` с `providerName: oldProviderName` — сгруппировать по (`taskType`, `tenantId`).
2. Для каждой группы: если в ТОЙ ЖЕ группе уже есть запись с `providerName === defaultProvider.providerName` на ДРУГОМ тире — по Р2 просто `delete` строку с `oldProviderName` (не дублировать). Иначе — `update` строки: `providerName: defaultProvider.providerName, model: defaultProvider.model`.
3. Записать `LlmTaskRouteChange` на каждую мигрированную/удалённую строку: `{taskType, tenantId, tier, changeType: 'removed_provider', before: {providerName: oldProviderName, model: <старая модель>}, after: {providerName: defaultProvider.providerName, model: defaultProvider.model}, changedById: userId, reason: 'provider_deleted_auto_migrated'}` — пиши НАПРЯМУЮ через `this.prisma.llmTaskRouteChange.create(...)`, НЕ через `AiModelsService` (см. REALITY-CHECK п.5).
4. Для legacy JSON-записей (`tier: null`, `providers` содержит `oldProviderName`) — заменить элемент массива на `{provider: defaultProvider.providerName, model: defaultProvider.model}`, дедуп по тому же правилу Р2 внутри массива.
5. После всех групп — `await this.router.refreshCache()` (нужен доступ к `LlmRouterService` — либо инжектировать, либо дать `AdminLlmProvidersService` optional-инжект `LlmRouterService` по образцу `BudgetGuardService`/других optional-зависимостей в этом кодовой базе).
6. Вернуть число мигрированных/удалённых строк.

`migrateDefaultChain(oldProviderName, defaultProvider)` — если `oldProviderName` есть в `llm.router.defaultChain`: заменить элемент на `{provider: defaultProvider.providerName, model: defaultProvider.model}` (дедуп по Р2, если дефолт там уже есть — просто убрать старую запись); сохранить через существующий механизм записи AdminSetting (найди, как `admin-settings.service.ts` пишет значения — `set`/`update`, не изобретай новый путь).

`[ASSUMPTION: точный метод записи AdminSetting-значения (не только чтения через getDynamic) — найди в AdminSettingsService/admin-settings.controller.ts перед реализацией, используй существующий, не пиши в Prisma напрямую в обход валидации/аудита этого механизма]`.

## Границы фичи

- ✅ Always: расширение файлов из «Контракт-first»; новая миграция Prisma; тесты для новой bulk-миграции (обе tenant-области, оба формата маршрутов, дедуп Р2, случай Р5).
- ⚠️ Ask first: если `apiClient`/`DELETE` не поддерживает body технически (см. `[ASSUMPTION]` §4) — до смены метода на `POST /:id/remove` спроси, не меняй молча публичный контракт удаления, если это заметно другим клиентам.
- 🚫 Never: несколько дефолтов одновременно; менять `LlmRouterService.call()`/`chooseProviders()`/tier-fallback-на-ошибках.

## Фазы

### [x] Фаза 1 — Данные и предпросмотр (backend)

**Ценность.** Как владелец платформы, вижу перед удалением провайдера, сколько маршрутов затронуто и на кого они переключатся, вместо голой ошибки.

**Файлы:** `backend/prisma/schema.prisma` (снипет §1) + миграция; `admin-llm-providers.service.ts` (`setDefaultProvider`, `getDefaultProvider`, `previewRemoval` — снипет §2); `dto/admin-llm-providers.dto.ts` (снипет §3); контроллер — только `GET :id/removal-impact` и `POST :id/set-default` (снипет §4, без ещё `remove`).

**Что НЕ входит:** сама миграция маршрутов при удалении (Фаза 2); фронт (Фаза 3).

**Зависимости:** нет.

**Acceptance:**
- `bun run prisma:migrate -- --name add-llm-provider-is-default` создаёт файл миграции в `backend/prisma/migrations/`; `bun run prisma:generate` без ошибок.
- `grep -n "isDefaultProvider" backend/prisma/schema.prisma` — поле на месте.
- Новый/расширенный `admin-llm-providers.service.spec.ts`: (а) `setDefaultProvider` снимает флаг со старого дефолта и ставит на новый (2 провайдера, назначить А, потом Б → у А `isDefaultProvider=false`); (б) `setDefaultProvider` с моделью, не принадлежащей провайдеру → `UnprocessableEntityException 'default_model_invalid'`; (в) `previewRemoval` корректно считает и тир-нормализованные, и legacy JSON маршруты, и per-tenant, и `inDefaultChain`.
- `bunx vitest run src/modules/admin/economics/admin-llm-providers.service.spec.ts` — зелёный.
- `bun run typecheck` (backend) — зелёный.

**Закрывает:** R1 (назначение дефолта), R2 (предпросмотр).

### [x] Фаза 2 — Bulk-миграция при удалении (backend)

**Ценность.** Как владелец платформы, удаляю занятого провайдера одним подтверждением — все маршруты (включая персональные настройки компаний) сами переключаются на дефолт, ничего не остаётся сломанным.

**Зависимости:** Фаза 1.

**Файлы:** `admin-llm-providers.service.ts` (`softDeleteWithFallback`, `migrateRoutesToDefault`, `migrateDefaultChain` — снипет §5); контроллер — `DELETE :id` с новым DTO (снипет §4, `RemoveProviderSchema`).

**Что НЕ входит:** UI (Фаза 3).

**Acceptance:**
- Тесты (`admin-llm-providers.service.spec.ts`):
  - Провайдер занят в 1 глобальном тир-маршруте, дефолт назначен → удаление проходит, маршрут переключён на дефолт, `LlmTaskRouteChange` создана с `changeType='removed_provider'`.
  - Провайдер занят в per-tenant маршруте (`tenantId` задан) → тоже переключается (Р4), `LlmTaskRouteChange.tenantId` соответствует.
  - Провайдер занят в legacy JSON-массиве (`tier: null`) → элемент массива заменён на дефолт.
  - Дефолт УЖЕ стоит в той же цепочке на другом тире → после удаления НЕТ дублирующей записи с тем же providerName в этой цепочке (Р2).
  - Дефолт НЕ назначен → удаление занятого провайдера по-прежнему бросает `provider_in_use_by_routes` (регрессия недопустима, Р3).
  - Удаление самого дефолтного провайдера БЕЗ `reassignDefaultTo` → `ConflictException 'must_reassign_default'`.
  - Удаление самого дефолтного провайдера С `reassignDefaultTo` → новый провайдер становится дефолтом, старый удалён, миграция маршрутов происходит на НОВЫЙ дефолт (не на старый).
  - Провайдер в `llm.router.defaultChain` → после удаления в цепочке стоит дефолт вместо него.
- `bunx vitest run src/modules/admin/economics/admin-llm-providers.service.spec.ts` — зелёный, включая старые кейсы (регрессия недопустима).
- `bun run typecheck`/`lint` (backend) — зелёные.

**Закрывает:** R3 (bulk-миграция), R4 (per-tenant), R5 (дедуп Р2), R6 (защита Р3), R7 (диалог-реассайн Р5), R8 (defaultChain).

### [x] Фаза 3 — Frontend

**Ценность.** Как владелец платформы, вижу в каталоге, кто дефолт, могу назначить нового в один клик, и при удалении занятого провайдера вижу понятное предупреждение вместо голой ошибки.

**Зависимости:** Фазы 1-2 (нужен реальный контракт API).

**Файлы:** `LlmProvidersClient.tsx` (карточка провайдера — добавить бейдж «★ По умолчанию» / кнопку «Сделать по умолчанию»; заменить `handleDelete`/`window.confirm` на кастомный диалог с `previewRemoval`; отдельный диалог для случая `must_reassign_default`); `frontend/src/api/admin-llm-providers.api.ts` (новые методы `previewRemoval`, `setDefault`, обновлённый `remove` с телом).

**Что НЕ входит:** backend (фазы 1-2).

**Acceptance:**
- `grep -n "isDefaultProvider\|По умолчанию" frontend/app/\(admin\)/admin/ai/catalog/LlmProvidersClient.tsx` — новые элементы на месте.
- `bun run typecheck` (frontend) — зелёный (согласован `ApiDto→DomainModel→UiModel` для новых полей).
- Ручная/живая проверка (или Playwright, если доступен суперадмин-доступ): назначить провайдера дефолтом → бейдж появился у него, исчез у старого; попытка удалить занятого НЕ-дефолтного провайдера → диалог с числом маршрутов и именем дефолта, подтверждение реально удаляет; попытка удалить дефолтного провайдера → диалог выбора нового дефолта, после подтверждения — новый дефолт назначен и старый удалён.

**Закрывает:** R9 (UI бейдж/назначение), R10 (диалог удаления), R11 (диалог reassign).

## Pre-mortem / Риски

- **Риск:** массовая миграция (потенциально сотни строк `LlmTaskRoute` + audit-записи) в одной операции — производительность/атомарность. **Митигация:** оборачивать в `$transaction`; при большом объёме — батчами (`updateMany` где возможно вместо цикла `update` по одной строке, кроме мест где нужен индивидуальный дедуп-чек Р2).
- **Риск:** `refreshCache()` `LlmRouterService` вызывается посреди активной обработки живых AI-запросов — переходное состояние. **Митигация:** это уже штатное поведение системы (cron и так рефрешит кэш раз в минуту), не новый риск.
- **Ревью-аспект для `strict-production-review-gate`:** проверить, что `migrateRoutesToDefault` не создаёт частично мигрированное состояние при ошибке на середине (транзакция должна откатывать ВСЁ или писать прогресс так, чтобы повторный запуск был безопасен).

## Idempotency / feature-flag / prod-deploy

- Миграция Prisma — аддитивная колонка, `prisma migrate deploy` на проде подхватит автоматически (стандартный флоу, ничего сверх).
- Ship-On: новая фича сразу доступна всем super_admin, без флага — это не «решение владельца про доступ/деньги», а инструмент управления собственным каталогом. Флаг не нужен.
- `apply-prod-deploy.ts` — новых seed/patch/backfill-скриптов эта фича не создаёт.
- `softDeleteWithFallback` при повторном вызове на уже удалённого провайдера — `getRow()` бросит `NotFoundException` (существующее поведение), это ожидаемо, не idempotency-нарушение.

## DoD

- `bun run typecheck`/`lint`/`build` (backend и frontend) — зелёные.
- `bunx vitest run` по изменённым/новым spec — зелёные, регрессий нет.
- `second-brain/01_projects/llm-providers-verified.md` — обновить описанием фичи «провайдер по умолчанию».
- Рефлексия в `second-brain/05_история/` после реализации.

## Итог

**Реализовано целиком, все 3 фазы.** Коммиты на `fix/invite-password-existing-user-multi-org`:
- `bf8d226e` — Фаза 1 (isDefaultProvider + миграция + previewRemoval)
- `8724b6fc` — Фаза 2 (softDeleteWithFallback + bulk-миграция + удаление мёртвого softDelete())
- `beadc958` — Фаза 3 (UI: бейдж, SetDefaultDialog, ReassignDefaultDialog) + попутный фикс `present()` (не возвращал `isDefaultProvider`)

Проверено: `typecheck`/`lint`/`build` backend+frontend зелёные; `bunx vitest run src/modules/admin/economics` — 10 файлов/240 тестов, регрессий нет. Миграция создана через `prisma migrate diff` (локальный shadow-DB сломан известной проблемой AGE-расширения — см. `second-brain/02_architecture/code-pitfalls.md`/память проекта), к локальной БД применена точечным `ALTER TABLE` (не полным `db push` — избежали несвязанного дрифта). На проде накатится штатно через `migrate deploy`.

**Что НЕ сделано / осталось:**
- Живая browser-проверка трёх сценариев (назначить дефолт → бейдж; удалить занятого не-дефолта → диалог с числом маршрутов; удалить дефолт → диалог реассайна) НЕ выполнена — нет доступа к суперадмину в момент реализации.
- Метрика на новую операцию (`incAdminAiModelsRouteChange`-аналог) не заведена — audit-лог в `LlmTaskRouteChange` есть, отдельного prom-client счётчика на bulk-миграцию нет. Не блокирует, можно добавить отдельным мелким тикетом.
- Push ветки — НЕ выполнен в рамках этой задачи (ждём отдельного подтверждения владельца, как и остальные коммиты этой сессии).
