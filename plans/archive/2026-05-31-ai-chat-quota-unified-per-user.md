---
дата: 2026-05-31
автор: Сергей (cодиректор) + Claude
статус: draft
функция: Единая per-user квота на AI-общение (Concierge + клоны)
блокеры: нет
---

# Единая per-user квота на AI-общение (Concierge + клоны)

## Мотивация

Сейчас лимиты на общение с AI-агентами Z разнородны и протекают:

- **Concierge** (`POST /api/v1/concierge/messages`): per-Org квота через `OrgConciergeQuota` + `ConciergeQuotaService` (Redis + БД-снапшот + cron). Daily 100, monthly 3000 на всю Org.
- **Клоны** (`POST /api/v1/clones/persons/:id/ask` и `roles/:id/ask`): per-user, только Redis, default 20/день — `ClonesService.assertRateLimit` ([backend/src/modules/clones/services/clones.service.ts:2109](../../backend/src/modules/clones/services/clones.service.ts#L2109)). Нет БД-снапшота, нет cron, нет UI-эндпоинта, нет admin-override.
- Между каналами **квоты не связаны**: пользователь может выжать клонов на 20 и продолжать долбить Concierge.

Хочется: **один счётчик на пользователя, общий для обоих каналов**, с двумя ступенями лимита по роли в Org:

| Роль в Org | Лимит сообщений/день |
|---|---|
| `owner`, `admin`, `coo` | **50** |
| остальные (`manager`, `member`, …) | **20** |

Per-Org квота Concierge (`OrgConciergeQuota`) **остаётся** как safety-net против абуза одной Org, но дефолты повышаются, чтобы новый per-user лимит резал первым (50 × 30 человек = 1500/день > текущих 100).

## Принципы решения

1. **Единый счётчик per-user** — Redis-ключ `ai_chat:{userId}:{YYYY-MM-DD}`, INCR из Concierge и из Clones. Один лимит, общий пул.
2. **Используем существующий `QuotaService`** ([backend/src/modules/quotas/quota.service.ts](../../backend/src/modules/quotas/quota.service.ts)) — там уже есть атомарный INCR+EXPIRE, snapshot в `UserQuotaCounter`, audit `quota.exceeded`, метрика `quota_exceeded_total`, 429 с `Retry-After`. Не дублируем.
3. **Cron-reset не нужен** — windowMs=24h, TTL Redis сам обнулит, snapshot уже есть. Это преимущество над паттерном `ConciergeQuotaService` (где cron был нужен из-за per-Org семантики + БД-зеркала).
4. **Resolver роли** — `RbacService` уже возвращает `membership.role` для (userId, tenantId). Admin-tier роли — ENV-список, не хардкод.
5. **Concierge per-Org квота остаётся**, но проверяется **после** per-user, и её дефолты повышаются до условно безопасных значений (см. Фаза 1).
6. **Удаление `assertRateLimit` в `ClonesService`** + удаление `CLONE_ASK_PER_USER_PER_DAY` ENV и `cfg.skill.cloneAskPerUserPerDay`.
7. **UI-эндпоинт `GET /api/v1/me/ai-chat/quota`** — возвращает `{dailyUsed, dailyLimit, role}` для виджета «осталось N сообщений сегодня» в AssistantSidebar и на странице клонов.

## Импакт (затронутые слои)

| Слой | Что меняется |
|---|---|
| **DB / Prisma** | Только дефолты `OrgConciergeQuota.dailyMessagesLimit/monthlyMessagesLimit` (в `cfg.concierge`, не в schema.prisma). Существующие строки не трогаем. |
| **Backend / NestJS** | Новый сервис `AiChatQuotaService`, новый модуль `AiChatQuotaModule` (или внутри `QuotasModule`). Интеграция в `ConciergeService.process()` и `ClonesService.askPerson/askRole`. Новый контроллер `MeAiChatQuotaController` или эндпоинт в существующем `MeCloneAccessController`. |
| **ENV** | Добавить `AI_CHAT_DAILY_LIMIT_ADMIN`, `AI_CHAT_DAILY_LIMIT_MEMBER`, `AI_CHAT_ADMIN_ROLES`. Удалить `CLONE_ASK_PER_USER_PER_DAY` (deprecation в env.schema). Повысить дефолты `CONCIERGE_DAILY_MESSAGES_LIMIT` и `CONCIERGE_MONTHLY_MESSAGES_LIMIT`. |
| **Frontend** | Заменить вызов `GET /concierge/quota` (или дополнить) на `GET /me/ai-chat/quota` в AssistantSidebar; добавить виджет в Clones UI. |
| **AI / LLM / S3 / LiveKit** | Не затронуто. |
| **Audit / Metrics** | Используем существующие `quota_exceeded_total{quota_name="ai_chat_messages_per_day"}` и `AuditLog(action='quota.exceeded')`. Новых сущностей не вводим. |

## Фазы

### Фаза 1 — Конфиг и ENV [ ]

Файл [backend/src/common/config/env.schema.ts](../../backend/src/common/config/env.schema.ts):

- Добавить блок `AiChatQuotaSchema`:
  ```ts
  const AiChatQuotaSchema = z.object({
    AI_CHAT_DAILY_LIMIT_ADMIN: z.coerce.number().int().positive().default(50),
    AI_CHAT_DAILY_LIMIT_MEMBER: z.coerce.number().int().positive().default(20),
    AI_CHAT_ADMIN_ROLES: z.string().default('owner,admin,coo'),
  });
  ```
- Подмерджить в общий `EnvSchema`.

Файл [backend/src/common/config/typed-config.service.ts](../../backend/src/common/config/typed-config.service.ts):

- Добавить getter `aiChatQuota`:
  ```ts
  get aiChatQuota() {
    return {
      dailyLimitAdmin: this.get('AI_CHAT_DAILY_LIMIT_ADMIN'),
      dailyLimitMember: this.get('AI_CHAT_DAILY_LIMIT_MEMBER'),
      adminRoles: this.get('AI_CHAT_ADMIN_ROLES')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    };
  }
  ```
- Повысить дефолты Concierge (safety-net):
  - `CONCIERGE_DAILY_MESSAGES_LIMIT`: 100 → **3000** (50 × 30 человек × 2 запас).
  - `CONCIERGE_MONTHLY_MESSAGES_LIMIT`: 3000 → **60000**.

Файл `backend/.env.example` (и `.env` если есть) — задокументировать новые переменные.

**Удалить** (после Фазы 4):
- `CLONE_ASK_PER_USER_PER_DAY` из env.schema.ts + typed-config.service.ts.
- `cfg.skill.cloneAskPerUserPerDay`.

**Тест:** [backend/src/common/config/typed-config.service.spec.ts](../../backend/src/common/config/typed-config.service.spec.ts) — кейс на парсинг `AI_CHAT_ADMIN_ROLES`, дефолты.

---

### Фаза 2 — Сервис `AiChatQuotaService` [ ]

Новый файл `backend/src/modules/ai-chat-quota/ai-chat-quota.service.ts`:

**Контракт:**

```ts
@Injectable()
export class AiChatQuotaService {
  constructor(
    private readonly quota: QuotaService,
    private readonly rbac: RbacService,
    private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Атомарный INCR + проверка лимита. На превышении — throw
   * QuotaExceededError (429 с retryAfterSeconds).
   *
   * Лимит вычисляется по роли пользователя в Org:
   *   - cfg.aiChatQuota.adminRoles → dailyLimitAdmin (50)
   *   - иначе → dailyLimitMember (20)
   */
  async tryConsume(input: { tenantId: string; userId: string }): Promise<{
    current: number;
    remaining: number;
    limit: number;
    role: string;
  }>;

  /** Текущее использование без инкремента (для UI). */
  async getUsage(input: { tenantId: string; userId: string }): Promise<{
    dailyUsed: number;
    dailyLimit: number;
    role: string;
  }>;
}
```

**Имплементация:**

```ts
private static readonly QUOTA_NAME = 'ai_chat_messages_per_day';
private static readonly WINDOW_MS = 24 * 60 * 60 * 1000;

private async resolveLimit(tenantId: string, userId: string): Promise<{ limit: number; role: string }> {
  const role = await this.rbac.getMembershipRole(tenantId, userId); // см. ниже
  const isAdmin = this.cfg.aiChatQuota.adminRoles.includes(role);
  return {
    limit: isAdmin ? this.cfg.aiChatQuota.dailyLimitAdmin : this.cfg.aiChatQuota.dailyLimitMember,
    role,
  };
}

async tryConsume(input) {
  const { limit, role } = await this.resolveLimit(input.tenantId, input.userId);
  const r = await this.quota.checkAndIncrement({
    userId: input.userId,
    quotaName: AiChatQuotaService.QUOTA_NAME,
    max: limit,
    windowMs: AiChatQuotaService.WINDOW_MS,
  });
  return { ...r, limit, role };
}
```

**Зависимости:**
- `RbacService` уже умеет читать `OrgMember.role` — нужно убедиться, что есть публичный метод `getMembershipRole(tenantId, userId): Promise<string>` или эквивалент. Если нет — добавить (Фаза 2.1).
- `QuotaService` уже глобальный (`QuotasModule` `@Global`).

**Фаза 2.1 (если нужно) — добавить `RbacService.getMembershipRole`:**

Файл [backend/src/modules/rbac/rbac.service.ts](../../backend/src/modules/rbac/rbac.service.ts):

- Проверить, есть ли уже метод (видно `membership.role` внутри `getEffectiveRole` или подобного).
- Если нет — добавить thin wrapper:
  ```ts
  async getMembershipRole(tenantId: string, userId: string): Promise<string | null> {
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: tenantId, userId } },
      select: { role: true },
    });
    return m?.role ?? null;
  }
  ```

**Модуль:** `backend/src/modules/ai-chat-quota/ai-chat-quota.module.ts`:

```ts
@Global()
@Module({
  imports: [RbacModule],
  providers: [AiChatQuotaService],
  exports: [AiChatQuotaService],
})
export class AiChatQuotaModule {}
```

Подключить в `app.module.ts`.

**Тест:** `ai-chat-quota.service.spec.ts` — кейсы:
- admin (owner/admin/coo) → 50.
- member/manager → 20.
- 50-е сообщение проходит, 51-е → 429.
- Concierge и Clones списываются из одного счётчика.

---

### Фаза 3 — Интеграция в Concierge [ ]

Файл [backend/src/modules/concierge/services/concierge.service.ts](../../backend/src/modules/concierge/services/concierge.service.ts):

- Добавить inject `AiChatQuotaService`.
- В `process()` перед текущим вызовом `this.quota.tryConsume(input.tenantId)` (per-Org) добавить:
  ```ts
  try {
    await this.aiChatQuota.tryConsume({
      tenantId: input.tenantId,
      userId: input.userId,
    });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      yield {
        type: 'quota_exceeded',
        scope: 'user_daily',
        retryAfterSeconds: err.retryAfterSeconds,
      };
      return;
    }
    throw err;
  }
  ```
- Per-Org `tryConsume(input.tenantId)` остаётся **после** per-user — это safety-net.

Файл [backend/src/modules/concierge/concierge.controller.ts](../../backend/src/modules/concierge/concierge.controller.ts):

- `GET /concierge/quota` оставляем (отдаёт Org-cap для админ-UI). Свой контракт не меняет.

Файл `backend/src/modules/concierge/services/concierge.service.spec.ts` — мок `AiChatQuotaService.tryConsume` для всех тестов, плюс новый кейс «per-user превышен → SSE-event `quota_exceeded` с `scope=user_daily`».

DTO `ConciergeStreamEvent` — добавить вариант `quota_exceeded` с `scope: 'user_daily' | 'daily' | 'monthly'` (расширить union, не ломать существующих consumers).

---

### Фаза 4 — Интеграция в Clones [ ]

Файл [backend/src/modules/clones/services/clones.service.ts](../../backend/src/modules/clones/services/clones.service.ts):

- Заменить `assertRateLimit(userId)` на `aiChatQuota.tryConsume({ tenantId, userId })` в `askPerson` и `askRole`.
- Удалить приватный метод `assertRateLimit` и связанные Redis-ключи `clone:ask:*`.
- В catch при `QuotaExceededError` — пробросить как есть (контроллер вернёт 429 через `AllExceptionsFilter`).

Файл `backend/src/modules/clones/clones.module.ts`:

- Импорт `AiChatQuotaModule` (если не глобальный — иначе ничего).
- Удалить inject `RedisService` если он использовался **только** для rate limit.

**Удалить:**
- `CLONE_ASK_PER_USER_PER_DAY` из env.schema (после Фазы 1).
- `cfg.skill.cloneAskPerUserPerDay` getter.
- Все упоминания в тестах `backend/test/integration/clones-refusal.spec.ts`, `clones-v2.service.spec.ts`.

**Тест:** обновить `clones.service.spec.ts` — кейс на превышение per-user через `AiChatQuotaService` (не `cloneAskPerUserPerDay`).

---

### Фаза 5 — UI-эндпоинт `GET /me/ai-chat/quota` [ ]

Новый файл `backend/src/modules/ai-chat-quota/ai-chat-quota.controller.ts` (или дописать в существующий `MeCloneAccessController` в `clones.controller.ts`):

```ts
@ApiTags('me')
@Controller('api/v1/me/ai-chat')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MeAiChatQuotaController {
  constructor(private readonly quota: AiChatQuotaService) {}

  @Get('quota')
  @ApiOperation({ summary: 'Дневная квота AI-общения текущего пользователя (Concierge + клоны вместе)' })
  async getMyQuota(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ dailyUsed: number; dailyLimit: number; role: string }> {
    if (!tenantId) throw new BadRequestException({ ok: false, error: { code: 'tenant_required' } });
    return this.quota.getUsage({ tenantId, userId: user.id });
  }
}
```

DTO с Zod-схемой; добавить в Swagger.

**Тест:** `ai-chat-quota.controller.spec.ts` — кейсы admin/member, проверка отдаваемого `dailyLimit`.

---

### Фаза 6 — Frontend: индикатор квоты [ ]

**Не делаю в этом ТЗ детальный план фронта**, потому что хочу сначала согласовать backend-контракт. Пометить:

- [ ] AssistantSidebar — добавить виджет «осталось N из L сообщений сегодня», источник `GET /me/ai-chat/quota`.
- [ ] Clones UI (`/clones`, `/clones/:id`) — тот же виджет.
- [ ] Toast при 429 → «Лимит общения исчерпан. Сегодня доступно {dailyLimit} сообщений.»

Создать отдельный план фронта или включить отдельной волной — решим после Фазы 5.

---

### Фаза 7 — Документация second-brain [ ]

| Файл | Что добавить |
|---|---|
| [second-brain/01_projects/api-layer.md](../../second-brain/01_projects/api-layer.md) | Новый эндпоинт `GET /me/ai-chat/quota`. |
| [second-brain/01_projects/concierge.md](../../second-brain/01_projects/concierge.md) | Раздел «Квоты»: упомянуть две ступени (per-user Z 50/20 и per-Org safety-net). |
| [second-brain/01_projects/clones.md](../../second-brain/01_projects/clones.md) | Заменить упоминание `cloneAskPerUserPerDay` на единую `ai_chat_messages_per_day`. |
| [second-brain/02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md) | Добавить модуль `ai-chat-quota`. |

---

### Фаза 8 — prod-deploy-log [ ]

[docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md):

- **Шаг 1 (ENV)**:
  - Добавить `AI_CHAT_DAILY_LIMIT_ADMIN=50`, `AI_CHAT_DAILY_LIMIT_MEMBER=20`, `AI_CHAT_ADMIN_ROLES=owner,admin,coo`.
  - Обновить дефолт `CONCIERGE_DAILY_MESSAGES_LIMIT=3000` и `CONCIERGE_MONTHLY_MESSAGES_LIMIT=60000` (или зафиксировать в `.env` явно, если сейчас стоит 100/3000).
  - Удалить `CLONE_ASK_PER_USER_PER_DAY` (deprecated).

- **Шаг 12 (smoke)**: добавить grep-проверки:
  - `curl -fsS http://localhost:3000/api/docs-json | jq '.paths["/api/v1/me/ai-chat/quota"]'` → not null.
  - Прометей-метрика `quota_exceeded_total{quota_name="ai_chat_messages_per_day"}` появляется после 21-го запроса member'а.

Деплой rollout не требует БД-миграции.

---

### Фаза 9 — Тесты и финальная верификация [ ]

- `bun run typecheck` (backend + frontend).
- `bun run lint`.
- `bun run test:unit` — все новые/обновлённые spec'и зелёные.
- `bun run test:integration` — клонов и Concierge.
- Ручной smoke в dev:
  1. Member-пользователь делает 20 запросов через `/concierge/messages` → 21-й даёт `quota_exceeded` (`scope=user_daily`).
  2. Admin делает 20 запросов через Concierge + 30 через клонов → 50-й проходит, 51-й — 429.
  3. `GET /me/ai-chat/quota` корректно показывает `dailyUsed`/`dailyLimit`/`role`.
  4. Per-Org Concierge квота не активируется при дефолтных лимитах в Org из 10 человек.

---

## Чек-лист производных заметок (из CLAUDE.md)

После merge:

- [ ] [second-brain/01_projects/api-layer.md](../../second-brain/01_projects/api-layer.md) — новый эндпоинт.
- [ ] [second-brain/01_projects/concierge.md](../../second-brain/01_projects/concierge.md) — две ступени квоты.
- [ ] [second-brain/01_projects/clones.md](../../second-brain/01_projects/clones.md) — единый счётчик.
- [ ] [second-brain/02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md) — новый модуль `ai-chat-quota`.
- [ ] [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md) — Шаг 1 (ENV) + Шаг 12 (smoke).

Prisma schema **не меняется** → Шаги 4/5 не требуются.
Seed/patch/backfill/migrate скрипты **не добавляются** → Шаги 6–10 не требуются.

## Что НЕ входит в ТЗ

- Per-Org квота для клонов (`OrgCloneQuota`) — не нужна, так как per-user покрывает оба канала.
- Месячные лимиты per-user — отказались (только daily).
- Cron-reset для per-user — не нужен (TTL Redis + snapshot).
- Frontend-имплементация (Фаза 6 — пометка, отдельный план).
- Tier-based лимиты (free/pro/enterprise) — не сейчас, можно добавить позже расширением resolver'а.

## Итог (заполняется после реализации)

- [ ] Реализовано полностью.
- [ ] Реализовано частично; осталось: _(заполнить)_.
- [ ] Откатили; причина: _(заполнить)_.
