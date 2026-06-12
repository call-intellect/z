# ТЗ: срочный фикс прод-багов — 500 на дашборде директора и 404 на решениях

**Дата:** 2026-06-12
**Тип:** bug-fix (срочный, прод)
**Статус:** готово к реализации (реализация НЕ начата)
**Источник:** живой аудит прод-кабинета korateam.ru — [plans/analysis/2026-06-12-product-audit-cabinet-ui-dashboards.md](../analysis/2026-06-12-product-audit-cabinet-ui-dashboards.md), болезни **Б-1** (мёртвая Главная) и **Б-7** (битые ссылки на решения).
**Целевая ветка:** отдельная (например `fix/dashboard-500-and-decisions-404`).

---

## 0. TL;DR

Два независимых прод-бага, пойманных вживую под аккаунтом владельца:

1. **🔴 `GET /api/v1/dashboard/director` → 500 `db_error`** (и `period=week`, и `period=month`). Главный экран владельца показывает красную плашку «Ошибка базы данных», нули в «Пользе за период», «Сводка появится после первой встречи» — при 13 встречах и существующей цели в системе. **Витрина продукта мертва.**
2. **🔴 `/decisions/<id>` → 404** (3+ в консоли на `/dashboard` и `/dashboard/operations/daily`). Клик по решению с дашборда / из радара / из недельной сводки ведёт в никуда.

Оба чинятся небольшими изменениями. Главное в фиксе №1 — **не «угадать упавший запрос», а сделать так, чтобы падение ОДНОГО виджета больше никогда не валило весь дашборд** (устойчивость + лог с именем упавшего виджета), и уже по логу прицельно добить корневой запрос.

---

## 1. Доказательная база (что измерено)

Снято Playwright под аккаунтом владельца (Org `cmpndk2tw000101mwmixvacuj`, «Ооо луа»):

| Эндпоинт | Результат |
|---|---|
| `GET /api/v1/dashboard/director?period=week` | **500** `{"ok":false,"error":{"code":"db_error","message":"Ошибка базы данных","requestId":"4N4GvoTmUs1x"}}` |
| `GET /api/v1/dashboard/director?period=month` | **500** `db_error` (requestId `YYGrHD7pvgjG`) |
| `GET /api/v1/dashboard/team-health` | **200** ✅ |
| `GET /api/v1/dashboard/pulse-patterns?period=week` | **200** ✅ |
| `GET /api/v1/dashboard/people-at-risk` | **200** ✅ |

**Вывод локализации:** соседние эндпоинты того же контроллера (team-health / pulse-patterns / people-at-risk) работают и уже трогают `Entity` / `IdeaBlock` / `Goal` / sentiment / commitment. Значит падает запрос, **уникальный для `getDirectorView`** (его не выполняет ни один из живых соседей). Глобальный exception-фильтр маскирует исходную Prisma-ошибку под `db_error` — какой именно из 14 запросов падает, из ответа не видно.

Фронтовые 404: роута `/decisions/[id]` **не существует** (в `frontend/app/(authenticated)/decisions/` только `page.tsx` + `DecisionsListClient.tsx`; деталь — master-detail на клиентском состоянии `setSelectedId`, отдельной страницы нет). При этом на `/decisions/<id>` ссылаются три места (Next.js префетчит их → 404):
- [frontend/src/ui/components/dashboard/IrreversibleDecisionsAlert.tsx:65](../../frontend/src/ui/components/dashboard/IrreversibleDecisionsAlert.tsx#L65) (виджет Главной — он и дал 404 в консоли);
- [frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx:502](../../frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx#L502);
- [frontend/app/(authenticated)/insights/InsightsListClient.tsx:615](../../frontend/app/(authenticated)/insights/InsightsListClient.tsx#L615).

В коде уже есть прямое признание дыры: комментарий в `frontend/src/ui/mobile/manager/MobileMemoryClient.tsx:18` — «Детального мобильного роута `/decisions/[id]` нет».

---

## 2. Корневой анализ

### Баг №1 — 500: отсутствие устойчивости в агрегаторе

[backend/src/modules/dashboard/services/director-dashboard.service.ts:129-168](../../backend/src/modules/dashboard/services/director-dashboard.service.ts#L129-L168) — метод `getDirectorView` запускает **14 запросов одним `Promise.all`** без какой-либо обработки ошибок отдельных веток:

```ts
const [ newThemes, newSignals, signalCounters, activeThemes, hotEntities,
  openQuestions, strategicAlignment, goalsTree, goalsPulse, sentimentRes,
  commitRes, hangingRes, valueStrip, mainReworkEnabled,
] = await Promise.all([ /* 14 fetch'ей */ ]);
```

`Promise.all` отклоняется (reject) при первой же ошибке любой ветки → весь метод бросает → контроллер отдаёт 500. **При этом тот же сервис УЖЕ применяет best-effort к двум другим веткам** — `fetchRequiresAction` (строки 413-439) и `getNarrativeSummary` (строки 356-404) обёрнуты в try/catch и при ошибке возвращают нейтральный fallback, «чтобы не валить весь дашборд». Эти 14 — нет. Это и есть корень Б-1: **архитектурная непоследовательность, а не разовый баг данных.**

Даже когда мы починим конкретный упавший запрос — завтра упадёт другой (новый виджет, новая колонка, дрейф схемы) и снова обнулит весь экран владельца. Поэтому правильный фикс — **сделать агрегатор устойчивым**, а не латать один запрос.

**Кандидаты на корневой упавший запрос** (запросы, уникальные для `getDirectorView`, которых нет у живых соседей) — для прицельного добивания после деплоя по логам:
- `fetchValueStrip` (строки 739-807) — raw-SQL по `ChatV2Message.citations` + `ChatV2Conversation`, `meeting.count` по relation `aiResult.summaryFast`, `ideaBlock` по `commitmentStatus='fulfilled'`;
- `fetchGoalsTree` / `fetchGoalsPulse` (881-1004) — `Goal` по колонкам `promotionState`, `validUntil`, `progressStatus`, `keyResults`;
- `fetchStrategicAlignment` (819-871) — `Goal.cachedAlignment` / `cachedAlignmentDelta`.

> **Гипотеза (не подтверждена):** дрейф схемы прод-БД (колонка из непрокатанной миграции). Память проекта фиксирует риск «db push без diff» и несколько незадеплоенных пушей. Подтверждается это ТОЛЬКО прод-логом по `requestId` (нужен явный «можно в прод» для `diag.ts`) ЛИБО само-вскроется после Фазы 1 — `logger.error` назовёт упавший виджет. См. Фазу 3.

### Баг №2 — 404: отсутствующий роут

Деталь решения существует только как правая колонка master-detail внутри `DecisionsListClient` (клиентский `selectedId`). Ссылки `/decisions/<id>` ведут на несуществующий сегмент App Router → 404. Фикс — добавить роут `/decisions/[id]`, который рендерит тот же master-detail с **предвыбранным** решением (тогда ссылка не просто перестанет давать 404, а станет рабочим deep-link'ом: клик с дашборда откроет нужное решение).

---

## 3. Рассмотренные альтернативы (и почему выбрано иначе)

**Баг №1:**
| Вариант | Вердикт |
|---|---|
| **A. Устойчивость: обернуть каждый из 14 запросов в `safe()` с fallback + лог имени** | ✅ **ВЫБРАНО.** Дашборд отдаёт 200 с тем, что загрузилось; падение виджета деградирует только его; лог называет упавший виджет (снимает маскировку `db_error`). Повторяет уже принятый в этом же файле паттерн (requiresAction / narrativeSummary). Чинит класс, а не кейс. |
| B. Найти упавший запрос по прод-логу и починить только его | Недостаточно: оставляет ту же бомбу (любой следующий сбой снова обнулит экран). Делается ВТОРЫМ шагом поверх A (Фаза 3). |
| C. `Promise.allSettled` + ручной разбор | Хуже A по типам: теряется типобезопасный per-ветка fallback, разбор `status==='rejected'` многословнее, имена виджетов вручную. |

**Баг №2:**
| Вариант | Вердикт |
|---|---|
| **A. Новый роут `/decisions/[id]` рендерит master-detail с `initialSelectedId`** | ✅ **ВЫБРАНО.** Один новый файл + проброс опц. пропа; чинит все 3 источника ссылок разом; делает ссылку рабочей (deep-link открывает решение); URL становится шарабельным. Аддитивно, существующее поведение не трогает. |
| B. Переписать 3 ссылки на `/decisions?selected=<id>` + чтение searchParam | 3 правки вместо 1 нового файла; не даёт чистого deep-link-роута; легче пропустить будущий 4-й линкер. |
| C. Просто убрать `<Link>`, сделать текстом | Убивает полезный переход «с дашборда к решению» — регресс UX. |

---

## 4. Объём и затронутые файлы

**Backend (баг №1):**
- `backend/src/modules/dashboard/dto/director-dashboard.dto.ts` — добавить опц. поле `degraded?: boolean` в `DirectorDashboardDto`.
- `backend/src/modules/dashboard/services/director-dashboard.service.ts` — обернуть 14 запросов в `safe()`, накапливать `failures: string[]`, защитить `isEmpty` от ложного срабатывания sample-story при сбое, проставить `degraded` в оба результата.

**Frontend (баг №2):**
- `frontend/app/(authenticated)/decisions/[id]/page.tsx` — **новый файл**, рендерит master-detail с `initialSelectedId`.
- `frontend/app/(authenticated)/decisions/DecisionsListClient.tsx` — принять опц. проп `initialSelectedId` и использовать как стартовое значение `selectedId`.

**Без миграций. Без новых ENV. Без новых флагов.** (`degraded` — опц. поле ответа, backward-compat; новой раскладкой уже рулит существующий kill-switch `dashboard.main_rework.enabled`.) Совместимость с prompt-caching — не применимо (LLM-промпты не меняются).

---

## 5. Фазы реализации

### Фаза 1 — устойчивость агрегатора (backend, чинит 500) `[x]`

**5.1.** В `DirectorDashboardDto` (`director-dashboard.dto.ts`) добавить опц. поле:
```ts
  /**
   * Б-1 устойчивость — true, если хотя бы один виджет не загрузился (ошибка БД)
   * и заменён нейтральным fallback. Дашборд при этом всё равно отдаётся (200),
   * а не падает в 500. Frontend может показать ненавязчивую плашку «часть
   * данных не загрузилась». Опциональное — backward-compat.
   */
  degraded?: boolean;
```

**5.2.** В `getDirectorView` перед `Promise.all` (после `const since = this.calcSince(...)`) ввести аккумулятор и обёртку:
```ts
// Б-1 устойчивость: главная директора — витрина продукта, не должна «умирать»
// целиком из-за падения одного виджета. Каждый запрос ниже оборачиваем в safe():
// при ошибке БД виджет деградирует до нейтрального fallback'а, а в логах
// остаётся ИМЯ упавшего виджета (раньше глобальный фильтр отдавал общий
// db_error без детализации). Тот же best-effort уже применён к requiresAction
// и narrativeSummary в этом же сервисе.
const failures: string[] = [];
const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    failures.push(label);
    this.logger.error(
      `director widget «${label}» fail (tenantId=${args.tenantId}, period=${args.period}): ${
        err instanceof Error ? err.message : String(err)
      }`,
      err instanceof Error ? err.stack : undefined,
    );
    return fallback;
  }
};
```

**5.3.** Каждую из 14 веток `Promise.all` завернуть в `safe(label, () => <текущий вызов>, <fallback>)`. **Деструктуризация результата и порядок не меняются.** Точные, типобезопасные fallback'и (сверены с DTO/возвратами сервисов):

| label | fn | fallback |
|---|---|---|
| `newThemes` | `this.fetchNewThemes(tenantId, since)` | `[]` |
| `newSignals` | `this.fetchNewSignals(tenantId, since)` | `[]` |
| `signalCounters` | `this.fetchSignalCounters(tenantId, since)` | `{ pain:0, feature_request:0, churn_risk:0, objection:0, risk:0, decision:0, commitment:0, other:0 }` |
| `activeThemes` | `this.fetchActiveThemes(tenantId)` | `[]` |
| `hotEntities` | `this.fetchHotEntities(tenantId, since)` | `[]` |
| `openQuestions` | `this.fetchOpenQuestions(tenantId)` | `[]` |
| `strategicAlignment` | `this.fetchStrategicAlignment(tenantId)` | `{ average: null, goalsCount: 0, alertGoals: [] }` |
| `goalsTree` | `this.fetchGoalsTree(tenantId)` | `[]` |
| `goalsPulse` | `this.fetchGoalsPulse(tenantId)` | `{ onTrackCount:0, atRiskCount:0, stalledCount:0, achievedCount:0, droppedCount:0, total:0 }` |
| `sentiment` | `this.sentimentSvc.getIndex({ tenantId })` | `{ value:0, trend:'flat', sparkline12w:[], totalCheckIns:0, days:7 }` |
| `commitment` | `this.commitSvc.getReliability({ tenantId, scope:'company' })` | `{ scope:'company', scopeId:null, windowDays:14, kept:0, broken:0, overdue:0, pendingActive:0, reliabilityPercent:0, reliabilityLowData:true, delta14d:null, sparkline12w:[] }` |
| `hangingDecisions` | `this.hangingSvc.count({ tenantId })` | `{ count:0, minAgeDays:7, minRaisedCount:2, sparkline12w:[] }` |
| `valueStrip` | `this.fetchValueStrip(tenantId, period)` | `{ meetingsProtocoled:0, tasksExtracted:0, decisionsExtracted:0, questionsAnsweredByMemory:0, commitmentsKept:0 }` |
| `mainReworkEnabled` | `this.config.getDynamic<boolean>('dashboard.main_rework.enabled', undefined, true)` | `true` |

> Тип `T` для `safe` выводится из `fn` (возврат сервисного метода), `fallback` проверяется на присваиваемость к `T` — поэтому литералы выше должны строго совпадать с `SentimentIndexDto` / `CommitmentReliabilityDto` / `HangingDecisionsDto` / `DirectorDashboard*Dto` (они сверены при написании ТЗ). `trend:'flat'` контекстно типизируется в `'up'|'flat'|'down'` — ок.

**5.4.** Защитить sample-story от ложного срабатывания при сбое. Текущая строка:
```ts
const isEmpty = totalSignals === 0 && totalThemes === 0;
```
→
```ts
// Если виджеты упали и деградировали до пустых fallback'ов — это НЕ «пустой
// tenant». Не подменять реальные (частичные) данные синтетическим «образцом»:
// показываем что есть + degraded=true.
const isEmpty = failures.length === 0 && totalSignals === 0 && totalThemes === 0;
```

**5.5.** Проставить `degraded` в ОБА возвращаемых объекта (`sampleResult` и `result`): `degraded: failures.length > 0`. (В sample-ветке это гарантированно `false` благодаря guard'у в 5.4 — консистентно.)

**DoD Фазы 1:** `getDirectorView` НИКОГДА не бросает из-за ошибки виджета; при ошибке любого виджета возвращает 200, в лог пишется `director widget «<label>» fail … <message>` со стеком; happy-path-форма ответа без изменений (кроме нового опц. `degraded`).

### Фаза 2 — роут детали решения (frontend, чинит 404) `[x]`

**5.6.** В `DecisionsListClient.tsx` добавить опц. проп и протащить в контент:
```ts
export function DecisionsListClient({ initialSelectedId }: { initialSelectedId?: string } = {}) {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) { /* без изменений */ }
  return <DecisionsListContent initialSelectedId={initialSelectedId} />;
}

function DecisionsListContent({ initialSelectedId }: { initialSelectedId?: string }) {
  ...
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  ...
}
```
(Существующее поведение `/decisions` без пропа неизменно: `initialSelectedId` undefined → `null`.)

**5.7.** Новый файл `frontend/app/(authenticated)/decisions/[id]/page.tsx` — строго по конвенции репо (Next 16, `params: Promise<...>` + `await`, ср. `goals/[id]/page.tsx`):
```tsx
import type { Metadata } from 'next';

import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileMemoryClient } from '@/ui/mobile/manager/MobileMemoryClient';

import { DecisionsListClient } from '../DecisionsListClient';

export const metadata: Metadata = { title: 'Решение' };

/**
 * `/decisions/[id]` — deep-link на конкретное решение. Рендерит тот же
 * десктопный master-detail реестр с предвыбранным решением (правая колонка
 * сразу грузит деталь). Чинит 404 от ссылок на дашборде, в радаре сигналов и
 * недельной сводке. Мобайл — та же лента «Память» (без предвыбора).
 */
export default async function DecisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <MobileShell
      mobile={<MobileMemoryClient />}
      desktop={<DecisionsListClient initialSelectedId={id} />}
    />
  );
}
```

**DoD Фазы 2:** `/decisions/<существующий id>` открывает master-detail с предзагруженной правой колонкой (нет 404, нет красной ошибки); префетч ссылок с `/dashboard`, `/dashboard/operations/daily|weekly`, `/insights` больше не даёт 404 в консоли; `/decisions` (без id) работает как раньше.

### Фаза 3 — прицельный добив корневого запроса (backend, опционально/после деплоя) `[ ]`

После выката Фазы 1 в прод-логах появится `director widget «<label>» fail …` с реальным Prisma-сообщением. По нему:
- если **дрейф схемы** (колонка/таблица отсутствует в проде) → прокатать недостающую миграцию (`prisma migrate deploy` уже зашит в деплой; проверить, что нужная миграция есть в `prisma/migrations` и применилась) — кода менять не нужно;
- если **баг запроса** (битый raw-SQL / неверный relation-фильтр) → точечно починить именно тот `fetch*`.

> Ускоренный путь (если владелец даёт «можно в прод»): прочитать прод-лог по `requestId` через `diag.ts logs`/`chain` ДО деплоя и назвать упавший виджет сразу. Без подтверждения — Фаза 3 выполняется после деплоя Фазы 1 по её же логам. **Фазы 1-2 от Фазы 3 не зависят и выкатываются первыми.**

**DoD Фазы 3:** упавший виджет грузится реальными данными (в ответе `degraded` снова `false` для этого tenant'а).

---

## 6. Верификация (DoD всего ТЗ)

Все команды — через `bun` (см. инженерные стандарты), из соответствующей папки.

**Backend:**
- `cd backend && bunx tsc --noEmit` — без ошибок.
- `cd backend && bunx vitest run src/modules/dashboard/services/director-dashboard.requires-action.spec.ts src/modules/dashboard/services/director-dashboard.goals.spec.ts src/modules/dashboard/services/director-dashboard.value-strip.spec.ts src/modules/dashboard/director-dashboard.controller.spec.ts` — зелёные (ассерты по полям `dto.requiresAction`/`dto.isEmpty`/`valueStrip`, новый опц. `degraded` их не ломает).
- Желательно добавить unit-тест устойчивости: замокать один `fetch*` так, чтобы он бросал → ожидать, что `getDirectorView` НЕ бросает, отдаёт остальные виджеты и `degraded === true`.
- `cd backend && bun run build` — собирается.

**Frontend:**
- `cd frontend && bun run typecheck` — без ошибок.
- `cd frontend && bun run build` — собирается (новый роут `/decisions/[id]` компилируется).

**Ручная приёмка (Playwright, прод после выката):**
- `GET /api/v1/dashboard/director?period=week` и `?period=month` → **200** (была 500); на `/dashboard` нет плашки «Ошибка базы данных».
- Клик по решению из виджета «Необратимые решения» на `/dashboard` и из недельной сводки → открывается `/decisions/<id>` с деталью, без 404 в консоли.

---

## 7. Прод-операции

- **Миграции:** нет (если Фаза 3 не вскроет дрейф схемы — тогда отдельной строкой прокат недостающей миграции через штатный `migrate deploy`).
- **ENV / флаги / seed / patch / backfill:** нет.
- **Деплой:** обычный `docker compose up -d --build backend` (backend) + пересборка frontend. Фазы 1-2 безопасны и не требуют ручных шагов.
- После выката Фазы 1 — **проверить прод-лог** на `director widget «…» fail`, это вход в Фазу 3.

---

## 8. Риски и совместимость

- **Backward-compat:** `degraded?` — опц. поле, старый frontend его игнорирует; форма happy-path-ответа не меняется. Новый роут аддитивен.
- **Риск «спрятать реальную поломку»:** устойчивость может замаскировать сбой виджета под тихую деградацию. Снимается тем, что (а) `logger.error` шумит в логи с именем виджета, (б) `degraded=true` в ответе — крючок для будущей плашки на фронте. Это осознанный размен: «дашборд жив с одним пустым виджетом» >> «весь экран владельца = 500».
- **Тесты:** happy-path не затронут (см. §6); риск только если какой-то спек делает строгий `toEqual` на ВЕСЬ DTO — проверено, таких нет (ассерты по отдельным полям).

---

## Итог

Реализовано: **Фазы 1-2 — да** (ветка `fix/dashboard-500-and-decisions-404`, коммиты `7ae5ce14` backend-устойчивость + `d68cff43` роут). Верификация зелёная: backend `tsc`/`eslint`/`build`=0, 5 спеков/14 тестов (вкл. новый resilience-spec); frontend `typecheck`/`build`=0, роут в манифесте сборки. Ни миграций, ни ENV, ни флагов. **Фаза 3 (прицельный добив корневого запроса) — НЕ начата:** designed-после-деплоя — после выката Ф1 прод-лог назовёт `director widget «<label>» fail …`; ускоренный путь до деплоя через `diag.ts` по `requestId` требует явного «можно в прод» владельца.
