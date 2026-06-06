---
type: tz
status: ready-to-implement
feature: employee-pulse-and-people-at-risk
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/tz/2026-06-02-main-screen-umbrella-tails-finalization.md
---

> Анализ-карта: plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md (секция «ТЗ-G») · Решения владельца: 2026-06-05

# ТЗ-G — Пульс сотрудника + «Сотрудники под риском»

## Цель

Оживить заглушку «Сотрудники под риском» на главной (она всегда пуста) и привести самый чувствительный экран Коры — «Пульс сотрудника» — к заявленной этике: показывать руководителю не голое число «73 из 100», а **«кому и чем помочь прямо сейчас»**, и не обещать в интерфейсе приватности, которой по факту нет.

## Зачем (болезненное состояние по факту)

1. **Виджет «Сотрудники под риском» мёртв.** `PeopleAtRiskWidget` всегда получает `items={null}` (`DirectorDashboardClient.tsx:586`), внутри `if (items === null) return null` (`PeopleAtRiskWidget.tsx:37`) — виджет физически не виден ни в одной Org. Эндпоинта `/dashboard/people-at-risk` нет — он лишь запланирован в незакрытом ТЗ tails-finalization Фаза 5 (все `[ ]`).
2. **Нет единого `pulseScore` на бэке.** «Pulse score» считается на лету в браузере (`PersonPulseClient.tsx:316` `computePulseScore`) и существует только на странице одного сотрудника. Виджет риска требует ранжирования всех сотрудников — без серверного скоринга его не построить.
3. **Вход в «Пульс» спрятан.** Единственный вход — pill-таб «Пульс» в `PersonSubpagesNav.tsx:43`, седьмой в ряду горизонтального скролла. В теле «Обзора» (`PersonDetailClient.tsx`) заметной кнопки нет — функция не используется, потому что в неё трудно попасть.
4. **Экран ранжирует, а не помогает.** Виджет рисует голую цифру `pulseScore` (`PeopleAtRiskWidget.tsx:81`) — это толкает сравнивать людей. Заявленная цель экрана — «повод поддержать», а не «кто плохой».
5. **Мёртвый placeholder.** `lastOneOnOneAt` всегда `null` (`person-pulse.service.ts:197` — `// v1 placeholder`), на UI явно не выводится, но висит в DTO как обещание несуществующей интеграции с календарём.
6. **UI обещает приватности больше, чем есть (Р2).** Forbidden-текст карточки гласит «доступен руководителям … или самому сотруднику» (`PersonPulseClient.tsx:140`), а в разборе простым языком зафиксировано: настроение и чек-ины руководитель и так видит всегда. Владелец решил: **owner/admin видят настроение ВСЕГДА, gate не вводить — но выровнять текст**, чтобы интерфейс не намекал на согласие там, где его не требуется.

---

## REALITY-CHECK

| Факт | Доказательство (path:line, символ) | Влияние на фазы |
|---|---|---|
| Виджет риска всегда скрыт: родитель шлёт `items={null}` | `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:586` (`<PeopleAtRiskWidget items={null} />`) | Ф2 — убрать `items={null}`, перейти на self-fetch |
| Виджет рендерит `null` при `items===null` | `frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx:37` (`if (items === null) return null`) | Ф2 — самофетч + success/empty/loading |
| Эндпоинта `/dashboard/people-at-risk` нет в dev | `backend/src/modules/dashboard/director-dashboard.controller.ts` (только `director`/`team-health`/`teams/:id`/`pulse-patterns`) | Ф1 — добавить метод сюда |
| Tails-finalization Фаза 5 — план эндпоинта, все `[ ]`, не реализован; ссылается на несуществующий `dashboard.controller.ts` | `plans/tz/2026-06-02-main-screen-umbrella-tails-finalization.md:433-471` | ТЗ-G **supersedes** эту фазу (см. «Граничные контракты») |
| Нет единого серверного `pulseScore`; есть только клиентский | `frontend/.../PersonPulseClient.tsx:316` (`computePulseScore`); `backend/.../person-pulse.service.ts` (DTO без `pulseScore`) | Ф1 — формула pulseScore на бэке |
| `engagementScore` 0..1, обновляется cron'ом раз в день | `backend/prisma/schema.prisma:4375` (`engagementScore Decimal? @db.Decimal(4, 3)`); `backend/src/modules/dashboard/agents/engagement-scorer.cron.ts:52` (`@Cron('0 3 * * *')`) | Ф1 — база скоринга, новой колонки НЕ вводим |
| `riskFlagsJson` хранит активные флаги с `severity` (источник «чем помочь») | `backend/prisma/schema.prisma:4384`; парсер `backend/.../person-pulse.service.ts:282` (`parseRiskFlags`) | Ф1 (topReason), Ф4 (фраза-действие) |
| Reliability считается по адресату (`commitmentRecipientPersonId`) | `backend/.../commitment-reliability.service.ts:250` (`scope==='person' → commitmentRecipientPersonId`) | Ф1 — штраф за просрочки берём через `getReliability(scope:'person')` как есть |
| Вход в «Пульс» только в pill-навигации (7-й таб) | `frontend/src/ui/components/persons/PersonSubpagesNav.tsx:43` (`{ segment: 'pulse', label: 'Пульс' }`) | Ф3 — заметная CTA в теле Обзора |
| `lastOneOnOneAt` — вечный `null` placeholder | `backend/.../person-pulse.service.ts:197` (`lastOneOnOneAt: null, // v1 placeholder`) | Ф5 — пометить как deprecated, на UI скрыть |
| RBAC карточки: owner/admin/coo ВСЕГДА; hr_partner — только при `analyticsOptIn`; self — всегда | `backend/src/modules/rbac/rbac.service.ts:352` (`canViewEmployeeFullCard`) | Ф6 — **не трогаем** (Р2: gate для owner/admin не вводим) |
| Forbidden-текст карточки намекает только на «руководителей или самого» | `frontend/.../PersonPulseClient.tsx:140` (`Просмотр Pulse-карточки доступен…`) | Ф6 — выровнять подписи приватности |
| `EthicsBanner` как отдельного компонента НЕТ; «обещания приватности» живут текстами в `PersonPulseClient` (footer PromisesCard `:829`, RiskFlags footer `:884`, forbidden `:140`) | grep `EthicsBanner` → 0 файлов | Ф6 — правим существующие подписи, новый баннер не плодим |

---

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р2 | owner/admin/coo видят настроение и чек-ины ВСЕГДА — gate по `analyticsOptIn` для них НЕ вводить; hr_partner-gate оставить | На 30 человек в админке «человек в цикле» деградирует в «соглашаются молча»; владельцу нужна полная картина по умолчанию. Требование: UI не должен обещать согласия там, где оно не требуется | 2026-06-05 |
| Л1 | `pulseScore` считать на лету в `PeopleAtRiskService`, БЕЗ новой колонки на первом этапе | `engagementScore` уже персистится cron'ом; добавлять денормализованную колонку преждевременно (feedback: крутилки в AdminSetting, схему трогают F/B/D — не плодим) | 2026-06-05 |
| Л2 | Эндпоинт живёт в `DirectorDashboardController`, доступ — `canViewDirectorDashboard` (owner/admin/super_admin) | Виджет на директорской главной; единая RBAC-калитка с остальными `/dashboard/*`; tails-Q3 («manager тоже видит») отклонён — это карточка людей, owner/admin достаточно | 2026-06-05 |
| Л3 | `pulseScore` = `engagementScore×100` минус штрафы за просроченные обещания и red-настроение; штрафы — пороги в AdminSetting (code-fallback в коде) | Голый engagement не отражает «горящие» сигналы; пороги настраиваемы super_admin'ом без передеплоя (feedback admin_settings) | 2026-06-05 |
| Л4 | `topReason` («чем помочь») берётся из активного risk-флага высшей severity; если флагов нет — из доминирующего штрафа (просрочки / настроение); fallback — нейтральная фраза | Возвращает экран к цели «забота», а не «ранжирование» (разбор §9) | 2026-06-05 |

---

## Scope

### Входит
- Backend: `PeopleAtRiskService` + формула `pulseScore` (на лету) + ранжирование по риску + `topReason`; эндпоинт `GET /api/v1/dashboard/people-at-risk`; кэш Redis TTL 5 мин; пороги штрафов в AdminSetting (с code-fallback).
- Frontend: подключение `PeopleAtRiskWidget` к реальному fetch (убрать `items={null}`); расширение item'а полем `topReason`/`department`; рендер фразы-действия вместо голого числа.
- Frontend: заметная CTA «Открыть Пульс» в теле «Обзора» карточки сотрудника (`PersonDetailClient`).
- Frontend/Backend: пометить `lastOneOnOneAt` как deprecated, скрыть из UI.
- Frontend (Р2): выровнять тексты-обещания приватности в `PersonPulseClient` (forbidden/footer'ы), чтобы UI не обещал лишнего; gate настроения для owner/admin НЕ вводить.

### Не входит
- Self-режим `PersonPulseClient` (`mode:'self'`, тон от первого лица, скрытие HR-резюме / Ревью ЗП) → **ТЗ-E** (`plans/tz/2026-06-05-personal-cabinet-me.md`). Координация: ТЗ-G выполняется РАНЬШЕ ТЗ-E, оба трогают `PersonPulseClient`.
- Введение gate настроения для owner/admin (Р2 — НЕ делать).
- Денормализованная колонка `Person.pulseScore` → vNext, если профилирование покажет нужду.
- Интеграция `lastOneOnOneAt` с календарём → vNext.
- Любые финансовые KPI (выручка/маржа/ЗП-числа) — продукт не про деньги.
- Drill-down полного списка под риском (страница) → vNext; в этом ТЗ виджет = топ-N + «+ ещё N».
- Изменение формулы `engagement-scorer.cron.ts` — не трогаем, читаем результат.

---

## Граничные контракты с другими ТЗ

- **Supersedes Фазу 5** `plans/tz/2026-06-02-main-screen-umbrella-tails-finalization.md:433-471`. Этот ТЗ-G — каноническая реализация `/dashboard/people-at-risk`. Контракт расширен относительно tails (добавлены `topReason`, `department`; формула с штрафами вместо голого `engagementScore×100`; RBAC = director-калитка вместо `dashboard:read`; контроллер = `director-dashboard.controller.ts`, а НЕ несуществующий `dashboard.controller.ts`). После реализации в tails-ТЗ Фаза 5 пометить `superseded by 2026-06-05-employee-pulse-and-people-at-risk.md`.
- **`PersonPulseClient.tsx` — общий с ТЗ-E.** ТЗ-G меняет ТОЛЬКО тексты приватности (Ф6) и не вводит `mode`-проп. ТЗ-E добавит `mode:'self'` поверх. Не переименовывать существующие функции/пропсы — ТЗ-E ждёт текущую сигнатуру.
- **`person-pulse.service.ts` (`PersonPulseDto`)** — ТЗ-G НЕ добавляет в него `pulseScore` (скоринг живёт в `PeopleAtRiskService`); меняет только JSDoc у `lastOneOnOneAt` (Ф5). Поле в DTO оставить (фронт его не показывает) — удаление сломает domain-маппер.
- **`canViewEmployeeFullCard` (`rbac.service.ts:352`)** — НЕ трогать (Р2). Логика owner/admin/coo=always уже верна.
- **Схему `schema.prisma`** этот ТЗ НЕ трогает (новой колонки нет). Поля `Goal.isPrimary`/`ownerPersonId`/`commitmentAuthorPersonId` — чужой scope (ТЗ-B/D/F).

---

## Контракт-first (единый источник правды фронт↔бэк)

### 1. Zod-DTO эндпоинта `GET /api/v1/dashboard/people-at-risk`

Файл: `backend/src/modules/dashboard/dto/people-at-risk.dto.ts` (новый).

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Query: топ-N сотрудников под риском. */
export const PeopleAtRiskQuerySchema = z.object({
  /** Сколько вернуть. Default 3, max 10. */
  limit: z.coerce.number().int().min(1).max(10).default(3),
});
export class PeopleAtRiskQueryDto extends createZodDto(PeopleAtRiskQuerySchema) {}
export type PeopleAtRiskQuery = z.infer<typeof PeopleAtRiskQuerySchema>;

/** Одна строка списка под риском. */
export const PeopleAtRiskItemSchema = z.object({
  personId: z.string(),
  name: z.string(),
  /** Отдел сотрудника (UI: подпись под именем). null если не задан. */
  department: z.string().nullable(),
  /** 0..100, чем НИЖЕ — тем критичнее. Округление вниз (Math.floor). */
  pulseScore: z.number().int().min(0).max(100),
  /**
   * Фраза-действие «чем помочь» (Л4). Не голое число, а повод для 1:1.
   * Пример: «Реже отвечает две недели — предложите разгрузку».
   * Никогда не пустая строка; при отсутствии сигналов — нейтральный fallback.
   */
  topReason: z.string().min(1),
  /** Когда последний раз пересчитан engagement (источник свежести). null до cron'а. */
  engagementScoreAt: z.string().nullable(),
});
export type PeopleAtRiskItem = z.infer<typeof PeopleAtRiskItemSchema>;

export const PeopleAtRiskResponseSchema = z.object({
  items: z.array(PeopleAtRiskItemSchema),
  /** Сколько всего сотрудников в зоне риска (pulseScore < RISK_THRESHOLD). Для «+ ещё N». */
  totalAtRisk: z.number().int().min(0),
  /** Когда сформирован ответ (ISO). */
  generatedAt: z.string(),
});
export type PeopleAtRiskResponse = z.infer<typeof PeopleAtRiskResponseSchema>;
```

### 2. Контроллер-метод (в существующем `DirectorDashboardController`)

```ts
// backend/src/modules/dashboard/director-dashboard.controller.ts
@Get('people-at-risk')
async peopleAtRisk(
  @CurrentOrg() tenantId: string | undefined,
  @Req() req: Request,
  @Query(new ZodValidationPipe(PeopleAtRiskQuerySchema)) q: PeopleAtRiskQuery,
): Promise<PeopleAtRiskResponse> {
  if (!tenantId) {
    throw new BadRequestException({ ok: false, error: { code: 'tenant_required', message: 'Не передан tenantId' } });
  }
  const userId = req.user?.id;
  if (!userId) {
    throw new ForbiddenException({ ok: false, error: { code: 'no_user', message: 'Требуется авторизация' } });
  }
  const allowed = await this.rbac.canViewDirectorDashboard(userId, tenantId);
  if (!allowed) {
    throw new ForbiddenException({ ok: false, error: { code: 'forbidden_role', message: 'Нет доступа к директорскому дашборду' } });
  }
  return this.peopleAtRiskSvc.getAtRisk({ tenantId, limit: q.limit });
}
```

Машинные коды ошибок (как у соседних методов контроллера): `tenant_required` (400), `no_user` (403), `forbidden_role` (403).

### 3. Формула `pulseScore` (в `PeopleAtRiskService.computePulseScore`)

```
base       = round( engagementScore * 100 )                 // engagementScore=null → base=50 (нейтраль)
penOverdue = min(OVERDUE_PENALTY_CAP, overdue14d * OVERDUE_PENALTY_PER_ITEM)
penMood    = redShare30d >= RED_MOOD_SHARE_THRESHOLD ? RED_MOOD_PENALTY : 0
pulseScore = clamp(0, 100, base - penOverdue - penMood)     // Math.floor на выходе
```

- `overdue14d` — `CommitmentReliabilityService.getReliability({scope:'person', scopeId, windowDays:14}).overdue` (адресат, как есть; см. REALITY-CHECK).
- `redShare30d` — доля `sentiment==='red'` среди отвеченных `DailyCheckIn` за 30 дней; знаменатель = отвеченные дни; 0 отвеченных → `penMood=0`.
- Пороги — `AdminSetting` (super_admin, history+audit) через `TypedConfigService.getDynamic`, с code-fallback:

| AdminSetting key | code-fallback | смысл |
|---|---|---|
| `peopleAtRisk.overduePenaltyPerItem` | `8` | штраф очков за каждое просроченное обещание |
| `peopleAtRisk.overduePenaltyCap` | `30` | максимум штрафа за просрочки |
| `peopleAtRisk.redMoodShareThreshold` | `0.34` | доля «красных» дней, с которой включается штраф настроения |
| `peopleAtRisk.redMoodPenalty` | `15` | штраф очков за устойчиво плохое настроение |
| `peopleAtRisk.riskThreshold` | `60` | pulseScore ниже → сотрудник «под риском» (для `totalAtRisk` и отбора) |

Ранжирование: сотрудники с `pulseScore < riskThreshold`, сортировка `pulseScore ASC` (худшие сверху), `take = limit`. `totalAtRisk` = count всех под порогом.

### 4. `topReason` (Л4) — выбор фразы-действия

```
1) если есть активные riskFlags → взять флаг высшей severity (high>medium>low) →
   маппинг type→фраза (таблица RISK_REASON_RU ниже);
2) иначе если penOverdue > 0 → «N просроченных обещаний — помогите расставить приоритеты»;
3) иначе если penMood > 0    → «Настроение проседает — стоит спросить, как дела»;
4) иначе                     → «Вовлечённость ниже обычного — повод для короткого 1:1».
```

`RISK_REASON_RU` (ключи = `Person.riskFlagsJson.flags[].type`, синхронно с `riskFlagLabel` в `PersonPulseClient.tsx:927`):

```ts
const RISK_REASON_RU: Record<string, string> = {
  sentiment_dip:       'Настроение падает — стоит спросить, как дела',
  reply_latency_rise:  'Реже отвечает в чатах — возможно, перегружен',
  missed_checkins:     'Пропускает чек-ины — предложите поддержку',
  broken_promises:     'Не успевает по обещаниям — помогите с приоритетами',
  workload_overload:   'Признаки перегрузки — обсудите нагрузку',
  meeting_noshows:     'Пропускает встречи — уточните, что мешает',
  conflict_mentions:   'Упоминания напряжения — стоит поговорить 1:1',
};
// неизвестный type → нейтраль из шага 4.
```

### 5. ASCII-поток

```
DirectorDashboardClient (Команда tab)
        │  SWR GET /api/v1/dashboard/people-at-risk?limit=3
        ▼
DirectorDashboardController.peopleAtRisk  ──RBAC── canViewDirectorDashboard
        │
        ▼
PeopleAtRiskService.getAtRisk(tenantId, limit)
        │  Redis GET people_at_risk:{tenant}:{limit}  (TTL 5 мин, hit→return)
        ├─ Person.findMany(tenantId, deletedAt:null, relationship:'employee')  // engagementScore, primaryDepartment, riskFlagsJson
        ├─ per person: CommitmentReliabilityService.getReliability(person) → overdue14d
        ├─ per person: DailyCheckIn 30d → redShare
        ├─ computePulseScore + topReason
        ├─ filter pulseScore<riskThreshold, sort ASC, take limit, count totalAtRisk
        │  Redis SET (TTL 5 мин)
        ▼
{ items:[{personId,name,department,pulseScore,topReason,engagementScoreAt}], totalAtRisk, generatedAt }
        ▼
PeopleAtRiskWidget (self-fetch) → строки: имя · отдел · topReason · score-chip → Link /persons/{id}/pulse
```

### 6. Кэш

Redis key `people_at_risk:{tenantId}:{limit}`, TTL 300с (паттерн `PersonPulseService` `:102`). Ошибки Redis не валят запрос — считаем live (try/catch как в `tryReadCache`/`tryWriteCache`).

### 7. Совместимость с prompt caching

Не релевантно — фича без LLM-вызовов (чистая SQL-агрегация + JSON-парсинг `riskFlagsJson`, который уже сформирован отдельным cron'ом). SYSTEM-промпты не затрагиваются.

---

## Границы автономии

✅ **Always (без спроса):**
- Реализация формулы/ранжирования/кэша в новом `PeopleAtRiskService`.
- Новый эндпоинт `GET /dashboard/people-at-risk` + Zod-DTO + регистрация в module.
- Подключение `PeopleAtRiskWidget` к fetch, добавление `topReason`/`department` в item, CTA в `PersonDetailClient`.
- Правка текстов приватности в `PersonPulseClient` (Ф6).
- Пометка `lastOneOnOneAt` deprecated в JSDoc + скрытие из UI.

⚠️ **Ask first:**
- Любое изменение `engagement-scorer.cron.ts` формулы.
- Введение новой колонки в `Person`.
- Изменение `canViewEmployeeFullCard` / RBAC-политик.
- Изменение сигнатуры/пропсов `PersonPulseClient` (ломает ТЗ-E).

🚫 **Never:**
- Gate настроения/чек-инов для owner/admin (нарушает Р2).
- Любые денежные KPI.
- Английские слова в UI; `text-white`/hex/slate; `prisma migrate`; `new PrismaClient()` в скриптах; `process.env.*` в коде.

---

## Фазы

Граф зависимостей: **Ф1 → Ф2**, **Ф1 → Ф4** (фраза-действие требует `topReason` из Ф1). Ф3, Ф5, Ф6 независимы (можно параллельно после Ф1, но Ф6 — раньше любых работ ТЗ-E).

| Фаза | Зависит от |
|---|---|
| Ф1 backend сервис + эндпоинт | — |
| Ф2 подключить виджет | Ф1 |
| Ф3 вход в Пульс из Обзора | — |
| Ф4 фраза «чем помочь» в виджете | Ф1, Ф2 |
| Ф5 deprecate `lastOneOnOneAt` | — |
| Ф6 выровнять тексты приватности (Р2) | — |

### Фаза 1 — Backend: `PeopleAtRiskService` + эндпоинт `/dashboard/people-at-risk`

**Цель:** серверное ранжирование сотрудников по риску с `pulseScore` на лету и `topReason`.

**Что входит:**
- Новый `backend/src/modules/dashboard/services/people-at-risk.service.ts` — `getAtRisk({tenantId, limit})`; формула §3; `topReason` §4; кэш §6; пороги через `TypedConfigService.getDynamic` с code-fallback §3.
- Новый `backend/src/modules/dashboard/dto/people-at-risk.dto.ts` (§1).
- Метод `@Get('people-at-risk')` в `director-dashboard.controller.ts` (§2).
- Регистрация `PeopleAtRiskService` в `dashboard.module.ts` providers (рядом с `PulsePatternsService:34/72`).

**Что НЕ входит:** новая колонка; правка cron'а; правка `PersonPulseDto`.

**Точные файлы:**
- `backend/src/modules/dashboard/director-dashboard.controller.ts` — добавить метод после `pulsePatterns` (`:192`); инжектить `PeopleAtRiskService` (символ `peopleAtRiskSvc`).
- `backend/src/modules/dashboard/dashboard.module.ts:60-72` — провайдер.
- Источник engagement: `backend/prisma/schema.prisma:4375` (`engagementScore`), `:4384` (`riskFlagsJson`), `:4403` (`primaryDepartment`).
- Reliability: `backend/src/modules/dashboard/services/commitment-reliability.service.ts:91` (`getReliability`, `overdue`).

**Зависимости:** нет.

**Acceptance:**
- `grep -n "people-at-risk" backend/src/modules/dashboard/director-dashboard.controller.ts` → найден `@Get('people-at-risk')`.
- `grep -n "class PeopleAtRiskService" backend/src/modules/dashboard/services/people-at-risk.service.ts` → найден.
- `grep -n "peopleAtRisk.overduePenaltyPerItem" backend/src/modules/dashboard/services/people-at-risk.service.ts` → найден (AdminSetting key).
- `grep -n "PeopleAtRiskService" backend/src/modules/dashboard/dashboard.module.ts` → в providers.
- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `bunx vitest run backend/src/modules/dashboard/services/people-at-risk.service.spec.ts` — зелёный.
- Пример вход→выход (5 employee, engagementScore=[0.30, 0.55, 0.85, null, 0.62], overdue/red нулевые, riskThreshold=60, limit=3):
  - pulseScore = [30, 55, 85, 50, 62]; под риском (<60): 30,55,50 → `items` отсортированы ASC = [30(personA), 50(personD), 55(personB)]; `totalAtRisk=3`; person с 85 и 62 не попали.
- Негативный: `?limit=99` → 400 Zod (нарушен `max(10)`); `?limit=0` → 400; без авторизации → 403 `no_user`; роль manager → 403 `forbidden_role`; нет `X-Org-Id` → 400 `tenant_required`.
- topReason: person с активным флагом `severity:'high', type:'workload_overload'` → `topReason==='Признаки перегрузки — обсудите нагрузку'` (не голое число).

**Тесты (`people-at-risk.service.spec.ts`):**
- сортировка ASC + respect limit + порог; 0 риск-сотрудников → `items:[], totalAtRisk:0`; `engagementScore=null` → base=50; штраф за overdue с cap; штраф за red-mood по порогу; topReason из высшей severity; topReason fallback при отсутствии флагов; Redis hit/miss (mock).

**Закрывает:** R1, R2, R5, R8.

### Фаза 2 — Frontend: подключить `PeopleAtRiskWidget` к реальному fetch

**Цель:** виджет перестаёт быть мёртвым — сам тянет данные и показывает топ-N.

**Что входит:**
- `frontend/src/api/dashboard.api.ts` — метод `peopleAtRisk(orgId, limit?)` через `apiClient` (ApiDto).
- `frontend/src/domain/` — маппер ApiDto→DomainModel `PeopleAtRisk` (цепочка ApiDto→DomainModel→UiModel, frontend-rules).
- `frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx` — self-fetch (SWR, паттерн как `TeamHealthGrid`); состояния loading/empty/error/data; `items===null && !loading → null` сохранить только для «эндпоинт ничего не вернул»; расширить `PeopleAtRiskItem` полями `department`, `topReason`.
- `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:586` — убрать `items={null}`, рендерить самофетчащийся `<PeopleAtRiskWidget />`; убрать/обновить комментарий `:582-584` про «endpoint не реализован».

**Что НЕ входит:** фраза-действие в рендере (Ф4 — отдельно, чтобы изолировать риск); страница полного списка.

**Точные файлы:**
- `frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx:35-38` (текущая `items===null` логика), `:81` (рендер числа).
- `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:582-587`.

**Зависимости:** Ф1.

**Acceptance:**
- `grep -n "items={null}" frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` → **0 совпадений**.
- `grep -n "peopleAtRisk" frontend/src/api/dashboard.api.ts` → найден.
- `grep -n "topReason" frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx` → найден.
- `cd frontend && bun run typecheck && bun run lint && bun run build && bun run test:unit` — зелёные.
- Ручной (smoke): Org с риск-сотрудниками → таб «Команда» → виджет показывает строки; пустая Org → success-state «Все сотрудники в норме» (`:42-46`) или скрыт.

**Закрывает:** R3.

### Фаза 3 — Frontend: заметный вход в «Пульс» из «Обзора» сотрудника

**Цель:** убрать «спрятанность» — в теле карточки появляется явная CTA.

**Что входит:**
- `frontend/app/(authenticated)/persons/[id]/PersonDetailClient.tsx` — для `isPerson` добавить заметную карточку-CTA «Открыть Пульс сотрудника» (`Link href={/persons/${entityId}/pulse}`, иконка `Activity`, парные токены `bg-accent/10 text-accent-fg`) в шапке/верхней зоне (после `PersonSubpagesNav`, до «Связанные блоки знаний» `:180`).
- Видна только тем, кто имеет доступ к карточке (та же логика, что `canSeePersonCommitments` `:557` — owner/admin/coo/super_admin); прочим CTA не рендерим (страница `/pulse` им всё равно вернёт 403).

**Что НЕ входит:** правка `PersonSubpagesNav` (pill оставляем как есть).

**Точные файлы:** `frontend/app/(authenticated)/persons/[id]/PersonDetailClient.tsx:178-181` (после `<PersonSubpagesNav/>`), `:557` (`canSeePersonCommitments` — переиспользовать).

**Зависимости:** нет.

**Acceptance:**
- `grep -n "Открыть Пульс" frontend/app/(authenticated)/persons/[id]/PersonDetailClient.tsx` → найден.
- `grep -n "/pulse" frontend/app/(authenticated)/persons/[id]/PersonDetailClient.tsx` → найден (href).
- В CTA нет английских слов; нет `text-white`/hex/slate (визуальный grep `bg-accent`).
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.

**Закрывает:** R6.

### Фаза 4 — Frontend: фокус «чем помочь» вместо голого числа

**Цель:** в строке виджета доминирует фраза-действие, число — вторично.

**Что входит:**
- `PeopleAtRiskWidget.tsx` — рендерить `topReason` как основной текст строки (под именем/отделом), а `pulseScore` оставить компактным chip'ом справа с тон-маппингом (существующий `:56-64`), но без визуального доминирования; tone по `pulseScore` (danger<30 / warning<60 / success иначе) — переиспользовать существующую логику.
- `aria-label` строки включает `topReason` для доступности.

**Что НЕ входит:** изменение самой фразы (она с бэка, Ф1).

**Точные файлы:** `frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx:66-86` (тело строки).

**Зависимости:** Ф1, Ф2.

**Acceptance:**
- `grep -n "topReason" frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx` → используется в JSX (не только в типе).
- Snapshot/unit: item `{pulseScore:30, topReason:'Признаки перегрузки — обсудите нагрузку'}` → в DOM присутствует текст фразы; число `30` присутствует, но не как единственный контент строки.
- `cd frontend && bun run typecheck && bun run lint && bun run build && bun run test:unit` — зелёные.

**Закрывает:** R4.

### Фаза 5 — Пометить `lastOneOnOneAt` как deprecated и убрать из UI

**Цель:** не висит мёртвый placeholder, обещающий несуществующую интеграцию.

**Что входит:**
- `backend/src/modules/persons/services/person-pulse.service.ts:68-69,197` — JSDoc: пометить `@deprecated v1 placeholder — интеграция с calendar отложена (vNext)`; значение оставить `null` (поле в DTO сохранить — domain-маппер фронта его ждёт).
- Frontend: убедиться, что `lastOneOnOneAt` нигде не рендерится на `/pulse` (grep). Если найдётся вывод — скрыть. (По текущему чтению `PersonPulseClient.tsx` не выводит — тогда достаточно backend-JSDoc + domain-комментария.)

**Что НЕ входит:** удаление поля из DTO (сломает маппер); интеграция с календарём.

**Точные файлы:** `backend/src/modules/persons/services/person-pulse.service.ts:68,197`; grep `lastOneOnOneAt` по `frontend/`.

**Зависимости:** нет.

**Acceptance:**
- `grep -n "@deprecated" backend/src/modules/persons/services/person-pulse.service.ts` → найден у `lastOneOnOneAt`.
- `grep -rn "lastOneOnOneAt" frontend/app frontend/src` → нет JSX-рендера (только тип/маппер, если есть).
- `cd backend && bun run typecheck` — зелёный.

**Закрывает:** R7.

### Фаза 6 — (Р2) Выровнять текст-обещание приватности

**Цель:** UI не обещает согласия там, где оно не требуется; gate для owner/admin НЕ вводим.

**Что входит:**
- `frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx:140` — forbidden-описание уточнить: карточка доступна руководителям организации (владелец / администратор / операционный директор) и самому сотруднику; HR-партнёр — только с согласия сотрудника. (Текст на русском, без английских слов; «COO» → «операционный директор».)
- Добавить компактную подпись-пояснение приватности на самой карточке (одна строка под шапкой `HeaderBlock` `:302`): для руководителей — «Эти данные видны руководителям организации; расширенная аналитика по сотрудникам без согласия — только HR-партнёрам». Парные токены, `text-fg-tertiary`.
- НЕ менять отдачу настроения/чек-инов; НЕ менять `canViewEmployeeFullCard`.

**Что НЕ входит:** `mode:'self'` и тон от первого лица (ТЗ-E); удаление HR-резюме (ТЗ-E).

**Точные файлы:** `frontend/.../PersonPulseClient.tsx:136-143` (forbidden), `:242-303` (`HeaderBlock` — добавить подпись).

**Зависимости:** нет. **ВАЖНО:** выполнить РАНЬШЕ ТЗ-E (общий файл).

**Acceptance:**
- `grep -n "операционный директор" frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx` → найден (нет «COO» латиницей в видимом тексте).
- `grep -rn "COO" frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx` → нет в JSX-строках (можно в комментариях).
- `grep -n "с согласия" frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx` → найдена подпись приватности.
- `canViewEmployeeFullCard` в `rbac.service.ts` не изменён (`git diff` пуст по этому методу).
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.

**Закрывает:** R9.

---

## Требования R1..R9 + трассировка

| R | Формулировка (EARS) | Фаза |
|---|---|---|
| R1 | Когда вызван `GET /api/v1/dashboard/people-at-risk?limit=N` авторизованным owner/admin/super_admin, система shall вернуть `items` длиной ≤ min(N,10), отсортированные по `pulseScore` ASC, и `totalAtRisk` = число сотрудников с `pulseScore < riskThreshold`. | Ф1 |
| R2 | Когда у сотрудника `engagementScore=null`, система shall использовать base=50; когда есть просроченные обещания, система shall вычесть `min(cap, overdue×perItem)`; когда доля «красных» дней ≥ порога — вычесть `redMoodPenalty`; результат shall быть clamp(0,100) и Math.floor. | Ф1 |
| R3 | Когда открыта главная (таб «Команда»), система shall показывать `PeopleAtRiskWidget` с данными из эндпоинта (не `items={null}`); при отсутствии риск-сотрудников — success-state «все в норме». | Ф2 |
| R4 | Когда виджет рендерит строку сотрудника, система shall показывать фразу-действие `topReason` как основной текст, а `pulseScore` — вторичным chip'ом. | Ф4 |
| R5 | Когда у сотрудника есть активный risk-флаг, система shall взять `topReason` из флага высшей severity; когда флагов нет — из доминирующего штрафа; иначе — нейтральный fallback; `topReason` shall быть непустой строкой. | Ф1 |
| R6 | Когда открыт «Обзор» карточки сотрудника пользователем с доступом к карточке, система shall показывать заметную CTA-ссылку на `/persons/{id}/pulse`. | Ф3 |
| R7 | Система shall пометить `lastOneOnOneAt` как `@deprecated` и не рендерить его в UI карточки Пульса. | Ф5 |
| R8 | Когда `limit` вне [1..10] или пользователь не авторизован / не owner-admin / без org, система shall вернуть соответствующий код ошибки (`400 Zod` / `403 no_user` / `403 forbidden_role` / `400 tenant_required`) и не утечь данные. | Ф1 |
| R9 | Система shall выровнять тексты приватности `PersonPulseClient` (forbidden + подпись на карточке) так, чтобы они не обещали согласия для owner/admin; gate настроения для owner/admin shall НЕ вводиться; hr_partner-gate shall сохраниться. | Ф6 |

---

## Pre-mortem / Риски + ревью-аспекты

- **N+1 по сотрудникам.** `getReliability` и `DailyCheckIn` per-person → на крупном tenant дорого. Митигейт: кэш 5 мин; на первом этапе фильтровать кандидатов по `engagementScore` (грубый отбор), точные штрафы считать только для отобранных ≤ ~30; при необходимости — batch-запрос чек-инов одним `groupBy`. Ревью: проверить число запросов.
- **Утечка чувствительных данных.** Эндпоинт отдаёт имена + «под риском». Ревью (strict-production-review-gate): RBAC-калитка = `canViewDirectorDashboard`; tenant-изоляция (`tenantId` в каждом where); negative-тест на manager/403.
- **Ранжирование людей = этический риск.** Митигейт: `topReason` как фраза-заботы (Л4), число вторично (Ф4); порог отбора, а не «рейтинг всех».
- **Ломаем ТЗ-E.** Ф6 трогает общий `PersonPulseClient`. Митигейт: только тексты, без смены сигнатур; ТЗ-G раньше ТЗ-E.
- **`riskFlagsJson` мусор.** Переиспользовать терпимый парсер (как `parseRiskFlags` `:282`) — невалидные флаги пропускать.
- **Кэш отдаёт устаревшее после правки порогов в AdminSetting.** Допустимо (TTL 5 мин); порог меняется редко.

---

## Idempotency / feature-flag / prod-deploy

- **Idempotency:** read-only фича; seed/patch/backfill НЕ нужны (новой колонки нет). Если решено завести AdminSetting-дефолты сидом — сид идемпотентен (upsert по key) и зарегистрирован в `backend/scripts/apply-prod-deploy.ts` STEPS (phase=update). На первом этапе значения берутся code-fallback'ом из `TypedConfigService.getDynamic` — сид не обязателен.
- **Feature-flag:** read-only без побочных эффектов и без риск-поведения — выделенный kill-switch не обязателен; де-факто «флаг» = наличие данных (виджет скрывается при пустом ответе). Если ревью потребует — завести `AdminSetting peopleAtRisk.enabled` (default true) и при false возвращать `items:[], totalAtRisk:0`.
- **Затронутые шаги `prod-deploy-log.md`:**
  - **Шаг 1 (ENV/AdminSetting):** 5 порогов `peopleAtRisk.*` как AdminSetting (super_admin, history+audit) — задокументировать дефолты; ENV не добавляется.
  - **Шаг 4 (schema):** не затронут (новой колонки нет).
  - **Шаг 12 (smoke):** `curl /api/v1/dashboard/people-at-risk?limit=3` → 200 + `{items, totalAtRisk, generatedAt}`; проверить 403 для manager.
  - Шаги 6/7/8 — только если решено сидить AdminSetting-дефолты (тогда Шаг 7 seed).

---

## DoD

- `cd backend && bun run typecheck && bun run lint && bun run build && bunx vitest run src/modules/dashboard/services/people-at-risk.service.spec.ts` — зелёные (вкл. `.spec`).
- `cd frontend && bun run typecheck && bun run lint && bun run build && bun run test:unit` — зелёные.
- Все Acceptance-grep'ы фаз дают ожидаемый результат; `items={null}` отсутствует в `DirectorDashboardClient`.
- second-brain по таблице производных заметок: `01_projects/api-layer.md` (новый эндпоинт), `02_architecture/module-map.md` (`PeopleAtRiskService`), профильная `01_projects/<pulse/dashboards>.md`.
- `docs/operations/prod-deploy-log.md` — Шаг 1 (AdminSetting дефолты) + Шаг 12 (smoke); при сиде — Шаг 7.
- Рефлексия в `second-brain/05_история/2026-06-05-employee-pulse-and-people-at-risk.md`.
- В tails-ТЗ Фаза 5 проставлена пометка `superseded by 2026-06-05-employee-pulse-and-people-at-risk.md`.

---

## Итог (заполняет оркестратор)

- [ ] Ф1 — Backend сервис + эндпоинт `/dashboard/people-at-risk`
- [ ] Ф2 — Подключить `PeopleAtRiskWidget` к реальному fetch
- [ ] Ф3 — Заметный вход в «Пульс» из «Обзора» сотрудника
- [ ] Ф4 — Фокус «чем помочь» (фраза-действие вместо числа)
- [ ] Ф5 — Deprecate `lastOneOnOneAt`, скрыть из UI
- [ ] Ф6 — (Р2) Выровнять тексты-обещания приватности

**Реализовано целиком:** нет (ТЗ, код не начат). Что осталось: все фазы.
