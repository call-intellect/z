---
type: tz
status: ready-to-implement
feature: llm-budget-downgrade-tier
date: 2026-07-04
owner: Tozix
relates_to:
  - plans/architecture/2026-07-04-llm-budget-downgrade-tier.md
  - plans/architecture/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md
  - plans/tz/2026-07-03-llm-metrics-rub-day-rate-fix.md
  - second-brain/04_не-сделано/README.md
  - docs/operations/feature-flags.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-07-04-llm-budget-downgrade-tier.md` · Статус согласования: одобрено 2026-07-04.

# ТЗ «Экономный режим лимита расходов на ИИ» (llm-budget-downgrade-tier)

## Принцип

Каждое требование ниже — точный контракт, не пожелание. Реализуй ровно так, как написано; если что-то кажется субоптимальным — это уже обсуждено в разделе «Доказательство выбора», не переизобретай на месте. Прочитай `CLAUDE.md`, `.claude/CLAUDE.md`, скиллы `nestjs-rules`, `prisma-db-push-rules` (**миграция НЕ нужна** — см. REALITY-CHECK), `z-ai-agent-rules`, `strict-production-review-gate` перед стартом.

**Вне scope / отложено владельцем:** общий платформенный потолок расходов по всем компаниям сразу (владелец явно отверг); self-service страница `/admin/org/economics` (не трогать); визуальный индикатор «сейчас экономный режим» на self-service странице (только уведомление); переписывание tier-fallback-на-ошибках; включение общего рубильника `llm.budget.enforce_enabled` (отдельное решение владельца, см. `plans/architecture/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md`).

## Цель + Зачем

Сегодня у лимита расходов на ИИ два состояния: «мягкий» (только уведомление) и «жёсткий» (полная остановка ИИ для компании до конца месяца). Жёсткий вариант рискован для бизнеса — компания вдруг перестаёт получать AI-отчёты о встречах и другие AI-функции. Добавляем третий режим — **«экономный» (`capKind='downgrade'`)**: при превышении лимита обращения к ИИ автоматически идут через более дешёвую модель из уже настроенной для задачи цепочки, вместо блокировки. Плюс — лимит «по умолчанию для всех компаний», который действует на компанию, если у неё нет собственного значения.

## REALITY-CHECK

Проверено по коду в этой же сессии (2026-07-04), актуально на момент написания:

1. **`OrgBudgetCap.capKind` — это `String @default("soft")` в Prisma, БЕЗ enum** (`backend/prisma/schema.prisma:3227`). Значит **добавление третьего значения 'downgrade' НЕ требует Prisma-миграции** — валидация целиком на уровне Zod (`admin-budget.dto.ts`) и ручных `===` сравнений в TS. Это резко сужает scope против того, что могло показаться на уровне архитектуры.
2. **`BudgetGuardService.evaluate()`** (`backend/src/modules/ai/services/budget-guard.service.ts:14-31`) сегодня: `over = capKind === 'hard' && mtdRub >= capRub`; при отсутствии строки `OrgBudgetCap` ИЛИ `monthlyCapRub == null` — сразу возвращает `{over:false, capRub:null, capKind: cap?.capKind ?? 'soft'}` (безлимит). Значит orgs без собственной строки уже сегодня по умолчанию `capKind='soft'` (не 'hard') — важно для R6 ниже.
3. **`LlmRouterService.call()`** (`backend/src/modules/ai/services/llm-router.service.ts:1592-1606`) — pre-dispatch budget-gate. Порядок в `call()`: `filtered` (providers, отфильтрованные по dataClass) строится на строках 1564-1570 → budget-gate на 1592-1606 → dispatch-цикл `for` начинается на 1614. **Budget-gate стоит МЕЖДУ построением `filtered` и циклом** — самое естественное место вставить reorder-логику для downgrade.
4. **Tier-fallback-на-ошибках** (тот же цикл, 1614-1810) уже даёт каждому `ProviderEntry` `tier` (`entry.tier ?? позиционный расчёт primary/secondary/tertiary`, строка 1620-1621) и `fallbackReason` (`null` для i=0, иначе `<tier>_<errCode>`, строка 1624-1627), пишет их в `AiUsageLog` через `this.usage.record(...)`. **Важно**: для routes, загруженных как tier-нормализованные (Ф.A.4, `refreshCache()` строки 1349-1367) — `entry.tier` ЗАДАН явно на объекте и «путешествует» вместе с ним при любой перестановке массива. Для **legacy**-маршрутов (JSON `providers` без tier, `refreshCache()` строки 1370-1378) — `entry.tier` НЕ задан, вычисляется ТОЛЬКО по позиции `i` в цикле. Значит перестановка массива для legacy-маршрутов исказит tier-метку (см. R4 — компенсируется явным `fallbackReason`, не полагаемся на точность `tier` для legacy).
5. **`MODEL_PRICES`** (`backend/src/modules/ai/services/model-prices.ts:7-44`) — плоская таблица `Record<modelName, {inputPer1M, outputPer1M, cachedPer1M?}>`, НЕ по `provider+model`. Несколько локальных моделей имеют цену `0` (`qwen3.5:9b`, `MiniMax-M2.7`, `gemini-3-flash`, `qwen3:30b-a3b-instruct-2507`) — это ОЖИДАЕМО «самые дешёвые» при сортировке (self-hosted).
6. **`BudgetAlertCron.runOnce()`** (`backend/src/modules/admin/economics/budget-alert.cron.ts:44-131`) сегодня запрашивает `orgBudgetCap.findMany({where: {monthlyCapRub: {not: null}}})` — **только Org, у которых УЖЕ есть явная строка с суммой**. Это значит: если ввести лимит «по умолчанию для всех» (R6) без правки этого запроса, компании БЕЗ собственной строки будут корректно ограничены/переведены в экономный режим на уровне `LlmRouterService` (R6 работает через `evaluate()`, вызываемый на каждый запрос), но **НИКОГДА не получат уведомление** — реестр находок `04_не-сделано` уже фиксировал похожий паттерн orphan-поведения. Это прямое нарушение обещания архитектуры «владелец получает уведомление о переходе в экономный режим» для большинства компаний (у которых сегодня нет строки вообще). **Это не опция — Phase 3 обязана расширить запрос cron'а**, иначе R9 физически не сработает для orgs без строки.
7. **`ConversationalService.sendNotification(...)`** (вызов — `budget-alert.cron.ts:91-108`) — рабочий канал, дедуп через `OrgBudgetCap.lastAlertAt`/`lastAlertThreshold`, owner ищется как `Membership{role:'owner'}` первый по `joinedAt`. Переиспользуется без изменений сигнатуры.
8. **`UpdateOrgBudgetSchema`** (`backend/src/modules/admin/economics/dto/admin-budget.dto.ts:3-7`): `capKind: z.enum(['soft','hard']).default('soft')`, `monthlyCapRub: z.number().nonnegative().nullable()` — **0 сегодня сохраняется КАК ЕСТЬ** (`unit-economics.service.ts` `upsertBudgetCap`: `args.monthlyCapRub != null ? args.monthlyCapRub.toFixed(2) : null` — 0 → `"0.00"`, НЕ null). Р5 архитектуры («0 = без лимита») сегодня НЕ выполняется технически — фикс обязателен (R8).
9. **Frontend `BudgetForm`** (`frontend/app/(admin)/admin/economics/orgs/[id]/OrgEconomicsDetailClient.tsx`) — `capKind` типизирован `"soft"|"hard"` буквально в `useState`; `monthlyCap` — пустая строка → `null` при submit, непустая → `Number(...)` без учёта «0 = безлимит».
10. **`admin-setting-schema-registry.ts`** — простой `Map<string, ZodTypeAny>`, без Prisma-миграции, без category/label-метаданных в этом файле (это чисто validation-реестр). Добавление нового ключа — одна строка.
11. **`BusinessMetricsService.incLlmBudgetExceeded({mode})`** — вызывается сегодня с `mode: 'enforce'|'observe'` (`llm-router.service.ts:1598`). Файл `business-metrics.service.ts` — 8931 строк, не вычитан построчно в этой сессии; при реализации **найди метод через vexp/grep по имени** и расширь тип `mode` до `'enforce'|'observe'|'downgrade'` — механическое расширение union, метод уже существует и работает.

## Принятые решения владельца (архитектура, НЕ пересматривать)

| # | Решение | Источник |
|---|---|---|
| Р1 | «Дешёвая модель» = самая дешёвая по факту цена среди моделей УЖЕ настроенной для задачи цепочки (не отдельный список) | Архитектура §7 Р1 |
| Р2 | Если в цепочке 1 модель или все равны по цене — экономный режим не деградирует, работает как обычно | Архитектура §7 Р2 |
| Р3 | Уведомление владельцу — одно за календарный месяц на переход в экономный режим | Архитектура §7 Р3 |
| Р4 | Экономный режим действует до конца календарного месяца, сброс 1-го числа | Архитектура §7 Р4 |
| Р5 | 0 в поле лимита (общем и на компанию) = без ограничений, хранится как NULL | Архитектура §7 Р5 |

## Технические решения этого ТЗ (мои, с обоснованием — REALITY-CHECK вскрыл детали, которых архитектура не специфицировала)

| # | Решение | Почему так |
|---|---|---|
| Р6 | Платформенный дефолт-лимит (`llm.budget.default_monthly_cap_rub`) подставляется в `evaluate()` ТОЛЬКО как **сумма** (`capRub`), когда у org нет собственной суммы (`cap` отсутствует ИЛИ `monthlyCapRub == null`). **Режим (`capKind`) для таких org остаётся тем, что уже есть в строке (если строка есть без суммы) либо `'soft'` (если строки нет вовсе)** — то есть платформенный дефолт САМ ПО СЕБЕ никогда не включает блокировку/даунгрейд без явного решения по конкретной компании. | Ship-On принцип 8 CLAUDE.md: решение, которое «может заблокировать/ограничить что видят люди», требует явно заданного владельцем параметра НА КОМПАНИЮ. Платформенный дефолт — это только сумма; чтобы она реально что-то ОГРАНИЧИВАЛА (не только уведомляла), владелец обязан явно проставить компании `capKind='hard'`/`'downgrade'`. Безопасный, обратимый выбор — не блокирует случайно компании, которые никогда не трогали бюджет. |
| Р7 | `llm.budget.enforce_enabled` продолжает гейтить ТОЛЬКО `capKind='hard'` (как сегодня). `capKind='downgrade'` **не гейтится этим флагом** — активен всегда, как только org явно выбрала «экономный» режим. | Экономный режим никогда не блокирует вызов (в отличие от hard) — сам выбор этого режима владельцем УЖЕ является согласием на действие. Городить второй наблюдательный (`observe`) под-режим для downgrade избыточно — это разные классы риска, `enforce_enabled` защищает только от «случайно вырубили всех» (hard), не от «случайно удешевили модель». |
| Р8 | `BudgetAlertCron` меняет источник обхода: вместо `orgBudgetCap.findMany({monthlyCapRub: not null})` — обходит ВСЕ активные Org (`org.findMany({where:{deletedAt:null}})`), считает эффективный `capRub`/`capKind` как `row?.monthlyCapRub ?? platformDefault` / `row?.capKind ?? 'soft'`; при необходимости отправить алерт org БЕЗ строки — **auto-vivify** (`upsert`) пустой строки (`capKind:'soft', monthlyCapRub:null, alertThresholds:[50,80,95]`) исключительно чтобы было куда писать `lastAlertAt`/`lastAlertThreshold` (дедуп). Это НЕ меняет её реальный лимит (evaluate() всё равно продолжит подставлять platformDefault, т.к. `monthlyCapRub` в этой авто-строке остаётся `null`). | Без этого фикса R9 физически не может выполниться для компаний без собственной строки (REALITY-CHECK п.6) — молчаливая дыра ровно того типа, который проект просит не оставлять. |

## Доказательство выбора (проход A/B)

**Развилка: как именно router выбирает «дешёвую модель» при `over && downgrade`.**

| Критерий | A — reorder `filtered` по цене перед циклом | B — пропустить сразу к последнему tier'у (tertiary) |
|---|---|---|
| Соответствует Р1 («самая дешёвая ПО ФАКТУ цена») | ✅ да, буквально | ❌ нет — tertiary это «последний сконфигурированный», не обязательно самый дешёвый (админ мог упорядочить по надёжности, не по цене) |
| Переиспользует существующий tier-fallback цикл без дублирования | ✅ да — тот же `for`, тот же `try/catch`, тот же `AiUsageLog.record` | ✅ тоже да |
| Корректно себя ведёт, если дешёвая модель тоже упадёт с ошибкой | ✅ да — цикл просто продолжает со следующей по цене (уже часть существующей логики fallback) | ✅ да |
| Риск для legacy (не-tier-нормализованных) маршрутов | ⚠️ tier-метка в `AiUsageLog` может быть неточной для позиционных маршрутов (закрыто R4 — явный `fallbackReason='budget_downgrade'`) | ⚠️ тот же риск, не закрывает Р1 |
| Новый код | Один блок сортировки перед циклом (~15 строк) | Один `if` перед циклом (~5 строк), но семантически неверно относительно Р1 |

**Выбор: A.** Она единственная реализует Р1 буквально («по факту цене», не «по позиции в списке»), риск с legacy tier-меткой закрыт явным маркером в `fallbackReason` (R4) — дешевле, чем городить отдельную систему выбора «дешёвых» моделей, и не противоречит принципу «не плодить код ради кода».

**Развилка: где триггерить уведомление о переходе в экономный режим.**

| Критерий | A — событийно из `LlmRouterService` в момент первого даунгрейда | B — из уже существующего `BudgetAlertCron` (раз в 2 часа) |
|---|---|---|
| Немедленность уведомления | ✅ сразу | ⚠️ до 2 часов задержки |
| Новый код в router (нарушение SRP — router начинает знать про уведомления) | ❌ да, новая зависимость `ConversationalService` в `LlmRouterService` | ✅ нет — router остаётся только про выбор модели |
| Новые Prisma-поля для дедупа (router не имеет доступа к `lastAlertAt` цикла cron'а) | ❌ нужны новые поля (`lastDowngradeNotifiedAt` и т.п.) | ✅ нет — переиспользует существующие `lastAlertAt`/`lastAlertThreshold` |
| Согласованность UX с уже существующим hard/soft-уведомлением (тот же canal, тот же % порог) | ⚠️ отдельный путь, легко разойдётся по формулировке | ✅ один код, один формат |

**Выбор: B.** До-2-часовая задержка приемлема для месячного бюджетного уведомления (тот же порядок задержки уже есть у существующих hard/soft-алертов, не новая деградация UX); ноль новых Prisma-полей; router остаётся SRP-чистым (только выбор модели, не оповещение).

## Scope

**Входит:**
- Backend: `capKind='downgrade'` end-to-end (DTO → сервис → router → уведомление).
- Backend: платформенный дефолт-лимит (`llm.budget.default_monthly_cap_rub`), 0 = безлимит.
- Backend: 0 в лимите на компанию = безлимит (хранится как NULL).
- Frontend: третий вариант в `BudgetForm`, подсказка «0 = без лимита».
- Метрика `incLlmBudgetExceeded({mode:'downgrade'})`.

**Не входит:**
- Общий платформенный потолок по всем компаниям сразу.
- Self-service страница `/admin/org/economics` — не трогать.
- Визуальный индикатор экономного режима на self-service странице.
- Переработка tier-fallback-на-ошибках.
- Включение `llm.budget.enforce_enabled` (отдельное решение владельца).
- Мелкая уборка данных `gpt-5-4` (`second-brain/04_не-сделано/README.md`, отдельный тикет).
- `llm.budget.mtd_cache_ttl_sec` в реестр (отдельный тикет, уже описан в `04_не-сделано`).

## Граничные контракты с другими ТЗ

- `plans/architecture/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md` — починил расчёт `costRub`/`mtdRub`; это ТЗ ЦЕЛИКОМ полагается на то, что `BudgetGuardService.getMtdRub()` уже возвращает реальные (не нулевые) суммы. Не переоткрывать эту логику.
- `plans/tz/2026-07-03-llm-metrics-rub-day-rate-fix.md` — уже зарегистрировал `llm.budget.enforce_enabled`/`llm.budget.currencyRateFallbackUsdRub` в `admin-setting-schema-registry.ts`; этот ТЗ добавляет туда ЕЩЁ ОДНУ строку рядом, не трогая существующие.

## Контракт-first

### 1. `backend/src/modules/admin/economics/dto/admin-budget.dto.ts` (изменить)

```ts
export const UpdateOrgBudgetSchema = z.object({
  monthlyCapRub: z
    .number()
    .nonnegative()
    .nullable()
    .transform((v) => (v === 0 ? null : v)), // Р5: 0 = без лимита, храним NULL
  capKind: z.enum(['soft', 'hard', 'downgrade']).default('soft'),
  alertThresholds: z.array(z.number().int().positive().max(1000)).min(1).default([50, 80, 95]),
});
```
`unit-economics.service.ts::upsertBudgetCap` — сигнатура `capKind: 'soft' | 'hard'` → `capKind: 'soft' | 'hard' | 'downgrade'` (тип и в вызове из `admin-economics.controller.ts::setBudget`).

### 2. `backend/src/modules/ai/services/budget-guard.service.ts` (изменить `evaluate`)

```ts
async evaluate(tenantId: string | null): Promise<BudgetEvaluation> {
  const NONE: BudgetEvaluation = { over: false, mtdRub: 0, capRub: null, capKind: 'soft' };
  if (!tenantId) return NONE;
  try {
    const cap = await this.prisma.orgBudgetCap.findUnique({ where: { tenantId } });
    let capRub = cap?.monthlyCapRub != null ? Number(cap.monthlyCapRub) : null;
    const capKind = cap?.capKind ?? 'soft';
    if (capRub == null) {
      // Р6 — платформенный дефолт-лимит, ТОЛЬКО сумма, режим не меняем.
      const defaultCapRub =
        (await this.cfg?.getDynamic<number>('llm.budget.default_monthly_cap_rub', undefined, 0)) ?? 0;
      capRub = defaultCapRub > 0 ? defaultCapRub : null;
    }
    if (capRub == null || !Number.isFinite(capRub) || capRub <= 0) {
      return { over: false, mtdRub: 0, capRub, capKind };
    }
    const mtdRub = await this.getMtdRub(tenantId);
    const over = (capKind === 'hard' || capKind === 'downgrade') && mtdRub >= capRub;
    return { over, mtdRub, capRub, capKind };
  } catch {
    return NONE;
  }
}
```
`[ASSUMPTION: если у org есть строка с capKind='downgrade' но monthlyCapRub=null — платформенный дефолт всё равно применяется как сумма, режим остаётся 'downgrade' (это уже её собственный явный выбор режима, не 'soft' по умолчанию — это единственная ветка, где defaultCapRub комбинируется с НЕ-'soft' capKind, и это осознанно: org уже явно выбрала downgrade, просто не указала сумму]`.

### 3. `backend/src/modules/ai/services/llm-router.service.ts` (изменить `call()`, между строками 1590 и 1608)

Вставить после существующего budget-gate блока (1592-1606), ДО строки 1608 (`const errors: ...`), заменяя текущий блок:

```ts
const bev = await this.budgetGuard?.evaluate(params.tenantId).catch(() => null);
let downgradeApplied = false;
if (bev?.over) {
  if (bev.capKind === 'downgrade') {
    const cheapnessScore = (model?: string): number => {
      if (!model) return Number.POSITIVE_INFINITY;
      const price = MODEL_PRICES[model];
      if (!price) return Number.POSITIVE_INFINITY;
      return price.inputPer1M + price.outputPer1M;
    };
    const withCost = filtered.map((entry, idx) => ({ entry, idx, cost: cheapnessScore(entry.model) }));
    withCost.sort((a, b) => a.cost - b.cost || a.idx - b.idx);
    const reordered = withCost.map((w) => w.entry);
    if (reordered.length > 0 && reordered[0] !== filtered[0]) {
      filtered.splice(0, filtered.length, ...reordered);
      downgradeApplied = true;
    }
    this.metrics?.incLlmBudgetExceeded({ mode: 'downgrade' });
  } else {
    const enforce =
      (await this.cfg?.getDynamic<boolean>('llm.budget.enforce_enabled', undefined, false)) ?? false;
    this.metrics?.incLlmBudgetExceeded({ mode: enforce ? 'enforce' : 'observe' });
    if (enforce) {
      throw new LlmBudgetExceededError(params.tenantId, bev.mtdRub, bev.capRub);
    }
    this.logger.warn(
      { tenantId: params.tenantId, mtdRub: bev.mtdRub, capRub: bev.capRub },
      'LlmRouter: бюджет превышен, но enforce выключен — пропускаю (observe)',
    );
  }
}
```

И внутри dispatch-цикла (строка 1624-1627, вычисление `fallbackReason`) — заменить:
```ts
const fallbackReason: string | null =
  i === 0
    ? downgradeApplied
      ? 'budget_downgrade'
      : null
    : `${lastFailTier ?? 'primary'}_${classifyError(errors[errors.length - 1]?.message ?? 'error')}`;
```

`MODEL_PRICES` уже импортирован в файл (`llm-router.service.ts:26`) — использовать напрямую, без нового импорта.

### 4. `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` (добавить рядом с существующими `llm.budget.*`, строка ~151)

```ts
['llm.budget.default_monthly_cap_rub', z.number().nonnegative()],
```

### 5. `backend/src/modules/admin/economics/budget-alert.cron.ts` (изменить `runOnce`)

Заменить `const caps = await this.prisma.orgBudgetCap.findMany({where: {monthlyCapRub: {not: null}}})` на обход всех активных Org + эффективный cap:

```ts
async runOnce(): Promise<{ capsScanned: number; alertsSent: number }> {
  const defaultCapRub =
    (await this.cfg.getDynamic<number>('llm.budget.default_monthly_cap_rub', undefined, 0)) ?? 0;
  const orgs = await this.prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  const existingCaps = await this.prisma.orgBudgetCap.findMany();
  const capByTenant = new Map(existingCaps.map((c) => [c.tenantId, c]));
  const thresholds = [...this.cfg.budget.alertThresholdPercents].sort((a, b) => b - a);
  let alertsSent = 0;
  const fxRate = await this.fx.getCurrentUsdRubRate();

  for (const org of orgs) {
    try {
      const existing = capByTenant.get(org.id);
      const ownCapRub = existing?.monthlyCapRub != null ? Number(existing.monthlyCapRub) : null;
      const limit = ownCapRub ?? (defaultCapRub > 0 ? defaultCapRub : null);
      if (limit == null || !Number.isFinite(limit) || limit <= 0) continue;
      const effectiveCapKind = existing?.capKind ?? 'soft';

      const m = await this.economics.computeForOrg(org.id, fxRate);
      const utilization = (m.costRubMonthToDate / limit) * 100;
      const lastAlertAt = existing?.lastAlertAt ?? null;
      const isNewMonth =
        !lastAlertAt ||
        lastAlertAt.getUTCFullYear() !== new Date().getUTCFullYear() ||
        lastAlertAt.getUTCMonth() !== new Date().getUTCMonth();
      const lastThreshold = isNewMonth ? null : (existing?.lastAlertThreshold ?? null);

      let trigger: number | null = null;
      for (const t of thresholds) {
        if (utilization >= t && (lastThreshold == null || t > lastThreshold)) {
          trigger = t;
          break;
        }
      }
      if (trigger == null) continue;

      const owner = await this.prisma.membership.findFirst({
        where: { orgId: org.id, role: 'owner' },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true },
      });
      if (!owner) continue;

      const message =
        trigger >= 100
          ? effectiveCapKind === 'downgrade'
            ? `С сегодняшнего дня расходы компании на ИИ достигли месячного лимита ${limit} ₽ — включён экономный режим: до конца месяца AI-функции используют более простую модель.`
            : `Бюджет AI на месяц превышен (${Math.round(utilization)}% от лимита ${limit} ₽).`
          : `Бюджет AI на месяц использован на ${Math.round(utilization)}% (${Math.round(m.costRubMonthToDate)} ₽ из ${limit} ₽).`;

      await this.conversational.sendNotification({
        tenantId: org.id,
        recipientUserId: owner.userId,
        eventType: 'system.message',
        payload: {
          kind: 'budget_alert',
          threshold: trigger,
          utilization: Math.round(utilization * 10) / 10,
          limitRub: limit,
          costRubMonthToDate: Math.round(m.costRubMonthToDate),
          message,
        },
        dataClass: 'internal',
        critical: trigger >= 100,
      });

      // Р8 — auto-vivify только для дедупа; monthlyCapRub остаётся NULL,
      // если org никогда не задавала свою сумму (платформенный дефолт не «прилипает»).
      await this.prisma.orgBudgetCap.upsert({
        where: { tenantId: org.id },
        create: {
          tenantId: org.id,
          monthlyCapRub: existing?.monthlyCapRub ?? null,
          capKind: effectiveCapKind,
          alertThresholds: existing?.alertThresholds ?? [50, 80, 95],
          lastAlertAt: new Date(),
          lastAlertThreshold: trigger,
        },
        update: { lastAlertAt: new Date(), lastAlertThreshold: trigger },
      });
      this.metrics.incBudgetAlertSent(trigger);
      alertsSent++;
    } catch (err) {
      this.logger.warn(
        { tenantId: org.id, err: err instanceof Error ? err.message : String(err) },
        'budget-alert: ошибка для tenant — продолжаю',
      );
    }
  }

  return { capsScanned: orgs.length, alertsSent };
}
```
`[ASSUMPTION: Org модель имеет поле deletedAt (soft-delete) — стандартный паттерн проекта (см. Membership { org: { deletedAt: null } } в resolveTenantByUser выше в llm-router.service.ts); проверить перед правкой]`.

### 6. Frontend `frontend/app/(admin)/admin/economics/orgs/[id]/OrgEconomicsDetailClient.tsx` (изменить `BudgetForm`)

```tsx
const [capKind, setCapKind] = useState<"soft" | "hard" | "downgrade">(
  (budget?.capKind as "soft" | "hard" | "downgrade") ?? "soft",
);
```
Добавить третий вариант радио-группы: `{ value: "downgrade", label: "Экономный — переходить на более дешёвую модель" }`. Поле `monthlyCap` — подпись `«0 = без лимита»`, `handleSubmit` без изменений (backend теперь сам транслирует 0→null через Zod `.transform`).

Новая крутилка `llm.budget.default_monthly_cap_rub` — `[ASSUMPTION: найди через vexp, где на фронте рендерится 'llm.budget.enforce_enabled' (вероятно экран AI/LLM-настроек или universal AdminSetting-редактор GET /admin/settings/schema/:key + useAdminSettingEditor — см. TC6 в 02_architecture/code-pitfalls.md); добавь новое поле рядом. Если выделенного экрана нет — регистрации в admin-setting-schema-registry.ts достаточно для generic-редактора, отдельный frontend-код не обязателен]`.

## Границы фичи

- ✅ Always: расширение существующих файлов из «Контракт-first»; регистрация новой крутилки в `admin-setting-schema-registry.ts`; тесты для всех изменённых веток.
- ⚠️ Ask first: если `Org` НЕ имеет поля `deletedAt` (см. `[ASSUMPTION]` выше) — уточнить фильтр активных Org другим способом, не гадать молча.
- 🚫 Never: трогать `/admin/org/economics` (self-service), Prisma-миграции (не нужны — `capKind` уже `String`), общий платформенный потолок по всем компаниям сразу.

## Фазы

### Фаза 1 — Данные и контракт лимита (backend, без миграций)

**Ценность.** Как владелец платформы, получаю возможность выбрать «экономный» режим и задать лимит по умолчанию для всех компаний, чтобы не настраивать лимит вручную каждой компании отдельно.

**Файлы:**
- `backend/src/modules/admin/economics/dto/admin-budget.dto.ts` — расширить `UpdateOrgBudgetSchema` (снипет §1).
- `backend/src/modules/admin/economics/unit-economics.service.ts` — тип `capKind` в `upsertBudgetCap` → `'soft'|'hard'|'downgrade'`.
- `backend/src/modules/ai/services/budget-guard.service.ts` — `evaluate()` (снипет §2).
- `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — новая строка (снипет §4).

**Что НЕ входит:** router (Фаза 2), уведомления (Фаза 3), frontend (Фаза 4).

**Зависимости:** нет (первая фаза).

**Acceptance:**
- `bunx vitest run backend/src/modules/ai/services/budget-guard.service.spec.ts` — зелёный + новые кейсы: (а) `capKind='downgrade'`, `mtdRub >= capRub` → `over===true`; (б) нет строки `OrgBudgetCap`, `llm.budget.default_monthly_cap_rub=5000` (замокать `cfg.getDynamic`) → `capRub===5000`, `capKind==='soft'`, `over===false` (т.к. mtdRub < 5000 в тесте) и отдельный кейс `mtdRub>=5000` → `over===false` (т.к. capKind остался 'soft' — платформенный дефолт НЕ включает блокировку сам по себе, Р6); (в) `llm.budget.default_monthly_cap_rub=0` (дефолт) → `capRub===null`, `over===false` (без регрессии текущего поведения).
- `grep -n "'downgrade'" backend/src/modules/admin/economics/dto/admin-budget.dto.ts` — находит новое значение enum.
- `grep -n "llm.budget.default_monthly_cap_rub" backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — 1 строка.
- Ручной прогон: `PATCH /api/v1/admin/orgs/:id/budget` с `{monthlyCapRub: 0, capKind: 'downgrade', alertThresholds:[80,100]}` → в БД `monthlyCapRub IS NULL`, `capKind='downgrade'`.
- `bun run typecheck` (backend) — зелёный.

### Фаза 2 — Экономный роутинг в LlmRouterService

**Ценность.** Как сотрудник компании в экономном режиме, продолжаю получать AI-отчёты о встрече (просто через более простую модель), вместо ошибки «ИИ недоступен».

**Зависимости:** Фаза 1 (нужен `capKind='downgrade'` из `evaluate()`).

**Файлы:** `backend/src/modules/ai/services/llm-router.service.ts` (снипет §3); найти `incLlmBudgetExceeded` в `backend/src/common/metrics/business-metrics.service.ts` (grep по имени — файл 8931 строк, не читать целиком) и расширить тип параметра `mode` до `'enforce' | 'observe' | 'downgrade'`.

**Что НЕ входит:** уведомления (Фаза 3), UI (Фаза 4), tier-fallback-на-ошибках (не трогать).

**Acceptance:**
- Новый файл `backend/src/modules/ai/services/llm-router.budget-downgrade.spec.ts` (по образцу существующего `llm-router.tier-fallback.spec.ts`), кейсы:
  - `over && capKind==='downgrade'`, цепочка из 2 моделей (дорогая primary, дешёвая secondary) → фактически вызывается дешёвая (`out.provider`/`out.model` совпадает с дешёвой), `AiUsageLog.record` вызван с `fallbackReason==='budget_downgrade'`.
  - Цепочка из 1 модели → вызывается как обычно, `fallbackReason===null` (Р2, не деградирует).
  - Все модели цепочки с одинаковой ценой → первая по позиции остаётся первой (`reordered[0] === filtered[0]`), `fallbackReason===null`.
  - `over && capKind==='hard'`, `llm.budget.enforce_enabled=true` → по-прежнему бросает `LlmBudgetExceededError` (регрессия существующего поведения не допущена).
  - `over && capKind==='soft'` → по-прежнему не блокирует, `incLlmBudgetExceeded({mode:'observe'})` (регрессия не допущена).
  - Дешёвая модель из reorder падает с ошибкой → цикл продолжает со следующей по цене (переиспользование существующего fallback, не новый путь).
- `bunx vitest run backend/src/modules/ai/services/llm-router.service.spec.ts backend/src/modules/ai/services/llm-router.tier-fallback.spec.ts backend/src/modules/ai/services/llm-router.budget-downgrade.spec.ts` — все зелёные (никаких регрессий в существующих спеках).
- `bun run typecheck` (backend) — зелёный.

### Фаза 3 — Уведомления (BudgetAlertCron)

**Ценность.** Как владелец компании без собственной настройки лимита, я всё равно узнаю́, когда включился экономный режим — не только компании с явно заданной суммой.

**Зависимости:** Фаза 1 (нужен `llm.budget.default_monthly_cap_rub`).

**Файлы:** `backend/src/modules/admin/economics/budget-alert.cron.ts` (снипет §5).

**Что НЕ входит:** router (Фаза 2), UI (Фаза 4).

**Acceptance:**
- `bunx vitest run backend/src/modules/admin/economics/budget-alert.cron.spec.ts` — зелёный + новые кейсы:
  - Org БЕЗ строки `OrgBudgetCap`, платформенный дефолт `5000`, `costRubMonthToDate >= 5000`, `capKind` эффективный `'soft'` (нет строки → дефолт) → уведомление ОТПРАВЛЕНО с дефолтным текстом (не «экономный режим», т.к. Р6: платформенный дефолт не меняет режим), после — строка `OrgBudgetCap` СОЗДАНА (`monthlyCapRub` остаётся `NULL`, `capKind='soft'`, `lastAlertAt`/`lastAlertThreshold` заполнены).
  - Org С явной строкой `capKind='downgrade'`, `monthlyCapRub=5000`, `utilization>=100%` → текст уведомления содержит «экономный режим».
  - Повторный `runOnce()` в тот же месяц с тем же `trigger` → `alertsSent` не увеличивается (дедуп не сломан).
  - Существующие кейсы (org с explicit `hard`/`soft` строкой, разные пороги) — без регрессий.
- `grep -n "org.findMany" backend/src/modules/admin/economics/budget-alert.cron.ts` — запрос теперь по всем Org, не только по `orgBudgetCap`.

### Фаза 4 — Frontend

**Ценность.** Как владелец платформы, вижу и могу выбрать «экономный» режим в той же форме, где сегодня выбираю «мягкий»/«жёсткий», не обращаясь к API напрямую.

**Зависимости:** Фаза 1 (нужны новые значения `capKind` в контракте API).

**Файлы:** `frontend/app/(admin)/admin/economics/orgs/[id]/OrgEconomicsDetailClient.tsx` (снипет §6); типы `AdminOrgBudgetApi`/`UpdateOrgBudgetRequest` в соответствующем `*.api.ts` (найти через vexp — расширить union `capKind`).

**Что НЕ входит:** backend (фазы 1-3), self-service `/admin/org/economics` (не трогать).

**Acceptance:**
- `grep -n "downgrade" frontend/app/\(admin\)/admin/economics/orgs/\[id\]/OrgEconomicsDetailClient.tsx` — находит новый вариант.
- `bun run typecheck` (frontend) — зелёный (union `capKind` согласован по всей цепочке `ApiDto→DomainModel→UiModel`).
- Ручная проверка (или через playwright, если доступен живой суперадмин-доступ — см. блокер QA этой сессии в `second-brain/04_не-сделано/README.md`): выбор «Экономный» в форме → сохранение → `BudgetView` отображает `(downgrade)`.

## Pre-mortem / Риски

- **Риск:** платформенный дефолт молча начинает блокировать компании, которые никогда не настраивали бюджет. **Митигация:** Р6 — дефолт влияет ТОЛЬКО на сумму, не на режим; без явного `capKind` на компанию режим остаётся `'soft'` (никогда не блокирует).
- **Риск:** `BudgetAlertCron` теперь сканирует ВСЕ Org вместо только тех, у кого есть `OrgBudgetCap` — при большом числе Org может вырасти нагрузка (N+1-подобный паттерн `computeForOrg` на каждую). **Митигация:** cron уже сегодня раз в 2 часа, `computeForOrg` — существующий метод (не новый), рост нагрузки линеен от числа Org (не квадратичный); если станет проблемой — заводить отдельную крутилку-порог «сколько Org сканировать за проход» вне scope этого ТЗ.
- **Риск:** `tier`-метка в `AiUsageLog` может быть неточной для legacy (не-tier-нормализованных) маршрутов после reorder. **Митигация:** R4 — `fallbackReason='budget_downgrade'` однозначно фиксирует причину независимо от точности `tier`.
- **Ревью-аспект для `strict-production-review-gate`:** проверить, что `filtered.splice(...)` не мутирует `DEFAULT_FALLBACK_CHAIN`/закэшированный `this.routes`-массив напрямую (должна мутироваться ТОЛЬКО локальная переменная `filtered`, не общий кэш — иначе следующий вызов той же задачи для ДРУГОГО tenant'а без превышения бюджета неожиданно получит переставленную цепочку).

## Idempotency / feature-flag / prod-deploy

- Никаких новых очередей/крон-джобов — `budget-alert.cron.ts` уже зарегистрирован. Изменение расписания НЕ требуется.
- Никаких Prisma-миграций (REALITY-CHECK п.1) — `prisma:generate` не требуется, `capKind` остаётся `String`.
- Новая крутилка `llm.budget.default_monthly_cap_rub` — Ship-On: дефолт `0` (безлимит) через code-fallback `getDynamic(..., 0)`, работает сразу после деплоя без действий владельца; владелец опционально задаёт положительное число когда захочет. Добавить строку в `docs/operations/feature-flags.md` (тип: решение владельца — платформенный лимит, дефолт безопасный 0).
- `apply-prod-deploy.ts` — новых `seed-*`/`patch-*`/`backfill-*`/`migrate-*` скриптов эта фича не создаёт (никаких данных не бэкафиллим).
- `BudgetAlertCron.runOnce()` идемпотентен и после изменения: повторный прогон в том же месяце с тем же `trigger` — no-op (дедуп через `lastAlertAt`/`lastAlertThreshold`, не меняется).

## DoD

- `bun run typecheck` / `bun run lint` / `bun run build` (backend И frontend) — зелёные.
- `bunx vitest run` по всем изменённым/новым spec-файлам (budget-guard, llm-router × 3, budget-alert.cron) — зелёные, без регрессий в существующих кейсах.
- `second-brain/01_projects/` — обновить профильную заметку по LLM-роутингу/бюджету (если есть) с новым режимом.
- `docs/operations/feature-flags.md` — строка на `llm.budget.default_monthly_cap_rub`.
- `second-brain/04_не-сделано/README.md` — закрыть строку про `llm.budget.enforce_enabled` (2026-07-04), перенести в архив с коммитом.
- Рефлексия в `second-brain/05_история/` после реализации.

## Итог

_Заполнит `tz-orchestrator` по завершении: реализовано целиком / частично, что осталось, ссылки на коммиты._
