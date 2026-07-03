---
type: tz
status: ready-to-implement
feature: llm-model-ab-experiments-real-split
date: 2026-07-03
owner: Tozix
relates_to:
  - plans/architecture/2026-07-03-llm-model-ab-experiments-real-split.md
  - plans/tz/2026-07-02-llm-providers-models-routing-admin.md
  - second-brain/04_не-сделано/README.md
---

> Архитектура (одобрена владельцем 2026-07-03): `plans/architecture/2026-07-03-llm-model-ab-experiments-real-split.md`. Статус согласования: одобрено, включая уточнение после одобрения (реальное имя UI-раздела — «Роутинг моделей», не «Модели ИИ»; см. блок «Уточнение» в архитектуре).

# ТЗ: A/B-эксперименты моделей реально делят трафик

## Принцип

Один канонический механизм A/B-теста модели по задаче (`LlmModelExperiment`), реально читаемый роутером на каждом вызове, со sticky-делением по встрече. Старый механизм (`LlmTaskRoute.experiment` JSON + `/admin/experiments`) выводится из эксплуатации полностью.

## Цель + Зачем

Владелец должен иметь ОДИН способ протестировать модель ИИ на части трафика перед полным переключением и увидеть после этого реальные, а не нулевые данные по варианту. Сегодня система для этого построена (`LlmModelExperiment` — Prisma-модель, CRUD-сервис, аналитика), но не подключена к фактическому выбору модели во время звонка — деньги и время, потраченные на эту систему в прошлой сессии (ТЗ `2026-07-02-llm-providers-models-routing-admin`), не окупаются, пока это не исправлено.

## REALITY-CHECK (проверено 2026-07-03, номера строк — на момент написания, перечитать перед правкой)

**Кто сегодня реально решает, какая модель обслуживает вызов:**
- `LlmRouterService.call()` (`backend/src/modules/ai/services/llm-router.service.ts:1522`) находит `route` в `this.allRoutes` (весь `LlmTaskRoute` целиком, включая JSON-поле `experiment`) и вызывает `chooseProviders(route, params)` (приватный метод, `:1861`).
- `chooseProviders()` (`:1861-1888`): если `route?.experiment` (тип `ExperimentConfig` — `enabled/modelA/modelB/splitPercent/startedAt/endsAt`, объявлен `:1070-1077`) задан, `enabled===true` и сейчас внутри окна `[startedAt, endsAt)` — берёт `Math.random() * 100 < splitPercent` (`:1874`), возвращает `{providers:[entry], experimentGroup: pickA?'A':'B'}` (`:1879`). Модель `LlmModelExperiment` эта функция НЕ импортирует и не читает вообще.
- `route.experiment` пишет/читает только `AdminExperimentsService` (`backend/src/modules/admin/services/admin-experiments.service.ts`) через `AdminExperimentsController` (`backend/src/modules/admin/controllers/admin-experiments.controller.ts`) — REST-маршруты `POST/GET/POST .../finish/POST .../cancel` под `/admin/experiments` (метод `startExperiment` пишет `route.experiment` напрямую в БД `:38-72`, `finishExperiment`/`cancelExperiment` очищают его через `Prisma.JsonNull`). Это ЖИВОЙ, полностью рабочий REST API — реально управляет реальным сплитом.
- Фронт легаси-системы: `frontend/app/(admin)/admin/experiments/page.tsx` + `ExperimentsListClient.tsx` (99 строк) + `ExperimentStartDialog.tsx` (129 строк, форма запуска: `taskType`/`modelB`/`splitPercent`/`durationDays`) + `frontend/app/(admin)/admin/experiments/[taskType]/page.tsx` + `ExperimentClient.tsx` (329 строк: `MetricsBlock`/`Row`/`RecentCallsList` — сравнение A/B по метрикам). API-клиент — `frontend/src/api/admin-experiments.api.ts` (экспорт `adminFunctionsApi`, домен `frontend/src/domain/admin-experiment.ts`). **Это полноценный, рабочий, не заглушка UI** — 557 строк кода, реально показывает сравнение control/variant.
- Nav-пункт легаси-системы: `frontend/app/(admin)/admin/navigation.ts:213-218` — `{ href: "/admin/experiments", label: "A/B-эксперименты", icon: FlaskConical }`. Это ЕДИНСТВЕННЫЙ видимый в навигации способ запустить A/B-тест модели сегодня.

**Что уже построено, но не подключено (`LlmModelExperiment`):**
- `AdminAiModelsService` (`backend/src/modules/admin/ai-models/ai-models.service.ts`): `switchPrimary()` (`:151` в прошлой сессии, перепроверить) при `dto.abSplitPercent < 100` вызывает `startExperimentImpl()` (создаёт `LlmModelExperiment` со статусом `running`, `autoStart` не передан → `status: args.autoStart === false ? 'draft' : 'running'` — по умолчанию сразу `running`). Отдельно — полноценный CRUD: `createExperiment`/`listExperiments`/`startExperiment`/`stopExperiment`/`experimentAnalytics`.
- `experimentAnalytics(id)`: считает `groupBy(['model','success'])` на `AiUsageLog` с `where: { taskType: exp.taskType, createdAt: {gte: exp.startedAt ?? new Date(0)}, model: {in: [exp.controlModel, exp.variantModel]} }` — группирует **по строке модели**, НЕ по `experimentGroup`. Это означает: как только `chooseProviders()` начнёт реально выбирать `controlModel`/`variantModel` для этого `taskType`, аналитика заработает автоматически, без доп. правок — но только если на время активного эксперимента ВСЕ вызовы этого `taskType` идут через сплит (что и обеспечивает ранний `return` в `chooseProviders()`, как в легаси-варианте) — не смешивается с посторонним трафиком той же модели на другие задачи (фильтр `taskType` уже в query).
- REST: `AdminAiModelsController` (`backend/src/modules/admin/ai-models/ai-models.controller.ts`), `@Controller('api/v1/admin')` (`:40`), `@UseGuards(CookieAuthGuard, SuperAdminGuard)` (`:41`), `@ApiExcludeController()` (внутренний инструмент, вне Swagger). Маршруты экспериментов: `POST/GET /llm-model-experiments`, `POST /llm-model-experiments/:id/start`, `POST /llm-model-experiments/:id/stop`, `GET /llm-model-experiments/:id/analytics` (`:114-158`).
- Фронт-клиент ГОТОВ, но НЕ ВЫЗЫВАЕТСЯ НИОТКУДА: `frontend/src/api/admin-ai-models.api.ts` экспортирует `adminAiModelsApi.experimentsList/experimentCreate/experimentStart/experimentStop/experimentAnalytics` (готовые типы `ModelExperimentApi`/`CreateExperimentRequest`) — ни один вызывается ни в одном `.tsx`-файле (проверено `grep` по `frontend/app`).
- Страница-хозяин: `frontend/app/(admin)/admin/ai/routing/[taskType]/RoutingDetailClient.tsx` — актуальная, самая свежая (коммит `c659775a`, **тот же день**, Фаза 8 родительского ТЗ) единая страница маршрутизации задачи. `TABS` (`:65-69`): `chain` / `metrics` / `history` — **нет вкладки A/B**. Именно эта Фаза 8 сознательно НЕ добавила A/B-вкладку — см. `second-brain/04_не-сделано/README.md` (строка 283): «A/B-контролы скрыты из нового UI `/admin/ai/routing`, чтобы не создавать иллюзию рабочего сплита».
- `switchPrimary()` не вызывается НИ ИЗ ОДНОГО фронтового файла — `ChainTabSection` (`RoutingDetailClient.tsx:110`) использует только `adminAiModelsApi.putChain` (`:283`), не `switchPrimary`. Значит `switchPrimary`+`abSplitPercent` бандл сегодня доступен ТОЛЬКО прямым HTTP-запросом (Swagger исключён — только curl/Postman с cookie).

**Скорректированный вывод (важнее для сути ТЗ, чем формулировка в архитектуре):** проблема НЕ «кнопка выглядит рабочей, но не работает» — сегодня **нет вообще никакой видимой кнопки** для `LlmModelExperiment`. Реально видимый и рабочий A/B — только легаси `/admin/experiments`. Задача этого ТЗ — перенести реальный сплит на модель данных `LlmModelExperiment` (она структурно лучше — не JSON-блоб, а таблица с `status`/`createdById`/раздельными `controlProvider`/`variantProvider`) и **построить для неё недостающий UI** на актуальной странице `RoutingDetailClient.tsx`, забрав рабочие идеи компоновки из легаси `ExperimentClient.tsx`/`ExperimentStartDialog.tsx` (не переизобретать), затем вывести легаси-систему из эксплуатации. Это не меняет продуктовое решение владельца (см. архитектуру, Шаг 8 — «РЕШЕНО: вариант А»), только уточняет объём фазы 3 (строим новое, а не чиним старое).

**Третья система (НЕ трогать):** `PromptCandidate(status='testing')` / `GepaCandidateEntry` / `pickGepaCandidate()` (`llm-router.service.ts:1450-1468`) — A/B промптов (не моделей), `experimentGroup='gepa_candidate'` (`:1543`) **перекрывает** базовый A/B по модели в `call()` (`:1538-1544`) — эта инвариантность (GEPA важнее базового A/B) должна сохраниться без изменений.

**Четвёртая, полностью не связанная сущность (анти-путаница для реализующего агента):** `backend/src/modules/experiments/` (`experiments.controller.ts`, `experiments.module.ts`, DTO `experiments.dto.ts`) и фронт `frontend/app/(authenticated)/experiments/` — это отдельный, никак не связанный ПРОДУКТОВЫЙ модуль (не про LLM), нав-пункт `frontend/src/ui/components/app-shell/nav-config.ts:310-315` (`label: "Эксперименты"`, `href: "/experiments"`, БЕЗ `/admin`-префикса). **Не трогать, не путать с `/admin/experiments`.**

**Существующие тесты:** `backend/src/modules/ai/services/llm-router.service.spec.ts` — фикстуры содержат `experiment: null` (`:50,62`), **нет ни одного теста на сам сплит** (ни легаси, ни новый). `backend/src/modules/admin/ai-models/ai-models.service.spec.ts` и `ai-models.controller.spec.ts` — есть тесты `switchPrimary`, но на моках сервиса, не на реальный сплит. Фазы ниже обязаны добавить недостающее покрытие, не просто починить существующее.

## Принятые решения владельца

| # | Решение | Обоснование | Не пересматривать |
|---|---|---|---|
| В1 | Канонический механизм — `LlmModelExperiment` (не `route.experiment`). `chooseProviders()` переключается на него полностью. | Владелец одобрил архитектуру 2026-07-03, вариант А: один способ вместо двух. `LlmModelExperiment` — структурно лучше (отдельная таблица, `status`-машина, `createdById`, раздельные `controlProvider`/`variantProvider` вместо парсинга строки `provider:model`). | Да |
| В2 | Легаси `/admin/experiments` (бэк + фронт + nav-пункт) выводится из эксплуатации полностью в рамках этого ТЗ, не «потом». | Ship-On (CLAUDE.md принцип 8) — фича мержа входит одним пакетом, включённой; оставлять второй работающий путь «на всякий случай» — ровно то раздвоение, которое чиним. | Да |
| В3 | Сплит трафика — sticky по встрече: один и тот же `meetingId` в рамках одного эксперимента всегда попадает в одну и ту же группу (control/variant), а не подбрасывается на каждый вызов. | Заложено как намерение в комментарии `LlmModelExperiment.splitPercent` («sticky-allocation по hash(meetingId)»), никогда не реализовано ни в одном из двух механизмов; честнее для сравнения (см. архитектуру Р1). | Да |
| В4 | Переключение «победителя» на 100% трафика — только ручная кнопка, не автоматика по итогам теста. | Архитектура Р2 — денежное решение, не отдаётся автоматике. | Да |
| В5 | `LlmTaskRoute.experiment` (колонка Prisma) НЕ удаляется в этой фиче — помечается как deprecated в `///`-комментарии, но не читается и не пишется новым кодом. | Минимизация риска: удаление колонки — отдельная миграция без функциональной ценности сейчас; правило проекта — не трогать лишнее сверх необходимого. См. Б1 ниже. | Нет — можно удалить отдельным поздним ТЗ, если понадобится чистка схемы |

## Доказательство выбора (два прохода + challenge-loop)

### Б1 — Источник данных для `chooseProviders()`: прямой запрос к БД на каждый вызов vs расширение существующего in-memory кэша

- **Проход A (прямой запрос).** На каждый вызов `chooseProviders()` делает `prisma.llmModelExperiment.findFirst({where:{taskType, tenantId:null, status:'running'}})`. Просто, но добавляет один SQL-запрос на КАЖДЫЙ вызов ИИ в системе (не только на вызовы с активным экспериментом) — латентность на горячем пути.
- **Проход B (расширение кэша).** `LlmRouterService` уже держит `private allRoutes`/`private routes` (Map), обновляемые в `refreshCache()` (`:1339-1387`) — по крону раз в минуту (`refreshCacheTick`, `:1327`) и explicit-вызовом после любой админ-мутации (пример: `AdminExperimentsService.finishExperiment` уже вызывает `this.router.refreshCache()`). Добавляем `private activeModelExperiments = new Map<string, LlmModelExperiment>()` (ключ — `taskType`, только `tenantId:null`), заполняем в том же `refreshCache()` одним доп. запросом `prisma.llmModelExperiment.findMany({where:{tenantId:null,status:'running'}})`, фильтруем по `startedAt<=now<endsAt` В МОМЕНТ ЧТЕНИЯ (не в кэш-запросе — окно нужно проверять каждый вызов, т.к. `now` меняется, а кэш обновляется раз в минуту — не проблема: минутная задержка окончания эксперимента приемлема, ровно как у легаси-механизма).

| Критерий | A (прямой запрос) | B (кэш) |
|---|---|---|
| Латентность горячего пути (вызов ИИ без активного эксперимента — подавляющее большинство) | Доп. SQL на каждый вызов | 0 — Map.get() |
| Соответствие существующему паттерну (`this.routes`) | Не соответствует | Совпадает 1:1 |
| Задержка применения нового/остановленного эксперимента | Мгновенная | До 60с (или мгновенно — `AdminAiModelsController` обязан вызывать `refreshCache()` после `start`/`stop`, как уже делает легаси-сервис) |
| Код ради кода | — | Переиспользует существующий механизм, не изобретает новый |

**Выбор: B.** Мгновенное применение легко закрыть явным `refreshCache()`-вызовом из `startExperiment`/`stopExperiment` (по образцу `AdminExperimentsService`) — тогда единственный источник задержки (крон раз в минуту) не мешает, т.к. администратор всегда меняет состояние через API, который сам обязан инвалидировать кэш.

### Б2 — UI: с нуля vs перенос легаси-компонентов

- **Проход A (с нуля).** Новый `ExperimentTabSection` в `RoutingDetailClient.tsx` пишется заново под `adminAiModelsApi`.
- **Проход B (перенос).** Берём структуру `ExperimentStartDialog.tsx` (форма: `modelB`→`variantModel`+`variantProvider`, `splitPercent`, `durationDays`) и `ExperimentClient.tsx` (`MetricsBlock`/`Row`/`RecentCallsList`) как основу, меняем источник данных на `adminAiModelsApi.experimentCreate/experimentsList/experimentAnalytics`, переносим файлы в `frontend/app/(admin)/admin/ai/routing/[taskType]/` (или общий `frontend/ui/components/admin/`, если переиспользование оправдывает вынос — на усмотрение реализующего агента, LOW-impact).

**Выбор: B** — компоненты уже написаны, протестированы визуально (реальный рабочий UI), решают ту же задачу (форма запуска + панель control/variant). Переписывать с нуля — код ради кода. `[ASSUMPTION: возможны косметические отличия макета от легаси — не критично, главное сохранить состав полей/данных]`.

### Challenge-loop (по решению В1+Б1+Б2)
1. **Корень, не симптом?** Да — чиним класс проблемы «два независимых A/B-механизма», а не точечно чиним аналитику одного из них.
2. **Самое эффективное?** Кэш вместо запроса на каждый вызов — не преждевременная оптимизация: это ТЕКУЩИЙ паттерн проекта для той же задачи (route-кэш), не гипотетическая нагрузка.
3. **Код ради кода?** Нет — Б1 продолжает существующий кэш-механизм, Б2 явно требует переиспользования уже написанного UI.

## Scope

### Входит
- Backend: `chooseProviders()` читает `LlmModelExperiment` вместо `route.experiment`; sticky-split по `meetingId`; `refreshCache()` расширен кэшем активных экспериментов; `startExperiment`/`stopExperiment`/`switchPrimary`(с `abSplitPercent`) инвалидируют кэш роутера.
- Backend: полное выведение из эксплуатации `AdminExperimentsService`/`AdminExperimentsController`/их DTO/регистрации в `admin.module.ts`.
- Backend: `///`-комментарий на `LlmTaskRoute.experiment` помечен deprecated; комментарий на `AiUsageLog.experimentGroup` актуализирован (ссылка на `LlmModelExperiment` вместо `LlmTaskRoute.experiment`).
- Backend: одноразовый идемпотентный скрипт-проверка на активные (`enabled:true`, ещё не истёкшие) записи `route.experiment` на момент миграции — если найдены, лог-предупреждение с инструкцией вручную пересоздать эксперимент в новом месте (без автоматического переноса — см. Scope «Не входит»).
- Frontend: новая вкладка A/B в `RoutingDetailClient.tsx` (создание/список/остановка/аналитика эксперимента), собранная на основе легаси-компонентов (Б2).
- Frontend: удаление `/admin/experiments` (+`[taskType]`) страниц и файлов, удаление nav-пункта `admin/navigation.ts:213-218`, удаление `admin-experiments.api.ts`/`domain/admin-experiment.ts` (если не используются больше нигде — проверить перед удалением).
- Тесты: юнит-тесты на sticky-split (детерминированность по `meetingId`, распределение ~splitPercent% по группам на большой выборке разных `meetingId`), на приоритет GEPA над базовым A/B (regression), на инвалидацию кэша при `start`/`stop`.

### Не входит
- Удаление колонки `LlmTaskRoute.experiment` из схемы (В5) — отдельная возможная будущая уборка.
- Автоматический перенос данных активных легаси-экспериментов в `LlmModelExperiment` — если на проде на момент выката найдётся активный `route.experiment`, администратор пересоздаёт его вручную в новом UI (её del ежедневный, некритичный сценарий — редкость активных тестов).
- UI-виджет для `switchPrimary`'s встроенного `abSplitPercent`-бандла внутри вкладки «Цепочка» — один явный вход (новая вкладка A/B) достаточен; не плодим второй путь запуска эксперимента.
- Изменения в GEPA-системе A/B промптов (`pickGepaCandidate`, `PromptCandidate`) — не трогать, только не сломать её приоритет.
- `backend/src/modules/experiments/` и `frontend/app/(authenticated)/experiments/` — не связанный продуктовый модуль, не трогать.
- Автоматика «переключить победителя» по итогам теста (В4).

## Контракт-first

### Хэш-функция sticky-split — переиспользуем существующую `simpleHash` (НЕ писать новую)

`llm-router.service.ts:2213` уже содержит стабильный fnv1a-hash, используемый для GEPA-семплирования:
```ts
function simpleHash(s: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193);
    h >>>= 0;
  }
  return h >>> 0;
}
```
Новая функция распределения группы (добавить рядом, файл-приватная):
```ts
function pickExperimentModel(
  exp: { id: string; controlModel: string; controlProvider: string; variantModel: string; variantProvider: string; splitPercent: number },
  meetingId: string | undefined,
): { provider: string; model: string; group: 'A' | 'B' } {
  const bucket =
    meetingId !== undefined
      ? simpleHash(`${exp.id}::${meetingId}`) % 100
      : Math.floor(Math.random() * 100);
  const pickVariant = bucket < exp.splitPercent;
  return pickVariant
    ? { provider: exp.variantProvider, model: exp.variantModel, group: 'B' }
    : { provider: exp.controlProvider, model: exp.controlModel, group: 'A' };
}
```
`[ASSUMPTION: без meetingId (системные/фоновые вызовы) — не sticky, обычный random per-call, как и раньше в легаси. Это редкий путь — большинство taskType с активным A/B относятся к отчётам встречи и всегда имеют meetingId.]`

### `chooseProviders()` — новая версия (замена блока `:1865-1882`)

```ts
private async chooseProviders(
  route: LlmTaskRoute | undefined,
  params: LlmCallParams,
): Promise<{ providers: ProviderEntry[]; experimentGroup: 'A' | 'B' | null }> {
  const exp = this.activeModelExperiments.get(params.taskType);
  if (exp) {
    const picked = pickExperimentModel(exp, params.meetingId);
    this.logger.debug(
      `experiment ${params.taskType}: group=${picked.group} → ${picked.provider}:${picked.model}`,
    );
    return { providers: [{ provider: picked.provider as LlmProviderName, model: picked.model }], experimentGroup: picked.group };
  }
  const cached = this.routes.get(params.taskType);
  if (cached && cached.length > 0) {
    return { providers: cached, experimentGroup: null };
  }
  return { providers: await this.resolveDefaultChain(), experimentGroup: null };
}
```
Блок `route?.experiment` (`:1865-1882` старой версии) удаляется целиком. Параметр `route` у `chooseProviders` после удаления легаси-ветки может стать неиспользуемым — оставить сигнатуру как есть (вызывающий код `call()` передаёт `route` для `resolveEffectiveDataClass`, трогать не нужно), но убедиться линтером, что параметр не помечается unused.

### `refreshCache()` — добавить заполнение `activeModelExperiments` (после блока `:1387`, до `this.gepaCandidates`-загрузки)

```ts
private activeModelExperiments = new Map<string, LlmModelExperiment>();
// ...внутри refreshCache(), после this.routes = map;
const activeExperiments = await this.prisma.llmModelExperiment.findMany({
  where: { tenantId: null, status: 'running' },
});
const expMap = new Map<string, LlmModelExperiment>();
const now = Date.now();
for (const e of activeExperiments) {
  const startedAt = e.startedAt?.getTime();
  const endsAt = e.endsAt?.getTime();
  if (startedAt === undefined || endsAt === undefined) continue;
  if (now < startedAt || now >= endsAt) continue;
  expMap.set(e.taskType, e);
}
this.activeModelExperiments = expMap;
```
Импорт типа `LlmModelExperiment` — из `@prisma/client` (уже используется в файле для других моделей типа `LlmTaskRoute`).

### Инвалидация кэша при мутациях

`AdminAiModelsService.startExperiment()`/`stopExperiment()`/`switchPrimary()` (ветка `abSplitPercent<100`) должны вызывать `this.router.refreshCache()` после успешной записи в БД — по образцу `AdminExperimentsService.finishExperiment()`/`cancelExperiment()`, которые уже это делают для легаси-пути. `AdminAiModelsService` уже инжектирует `LlmRouterService` как `this.router` (см. конструктор) — добавить вызов, отдельного DI не требуется.

### Zod-схема для новой вкладки — переиспользовать существующие типы, новых DTO не создавать

`CreateExperimentRequest`/`ModelExperimentApi` (`frontend/src/api/admin-ai-models.api.ts:118-152`) и backend `CreateExperimentSchema`/`CreateExperimentDto` (`backend/src/modules/admin/ai-models/dto/*`, найти точный файл через `get_skeleton` на старте фазы 3) уже полностью описывают контракт — новых полей не требуется.

## Границы фичи

- ✅ Always: переиспользовать `simpleHash`, существующий кэш-паттерн `refreshCache()`, существующие Zod DTO `LlmModelExperiment`, существующие фронт-компоненты легаси-UI как основу.
- ⚠️ Ask first: если при удалении `AdminExperimentsService` обнаружатся ДРУГИЕ потребители (`route.experiment`/`ExperimentConfig`) вне уже перечисленных в REALITY-CHECK файлов — остановиться и уточнить у владельца, не удалять втихую.
- 🚫 Never: не трогать `pickGepaCandidate`/`GepaCandidateEntry`; не трогать `backend/src/modules/experiments/` и `frontend/app/(authenticated)/experiments/`; не удалять колонку `LlmTaskRoute.experiment` из схемы; не вводить автоматическое переключение победителя.

## Фазы

### Фаза 1 — Backend: sticky-split читает `LlmModelExperiment`

**Ценность.** Как владелец компании, я получаю реально работающий A/B-тест модели (variant получает свою долю трафика), чтобы обоснованно решать, переключать ли модель для всех.

**Файлы:** `backend/src/modules/ai/services/llm-router.service.ts` (`chooseProviders` `:1861-1888`, `refreshCache` `:1339-1387`, добавить `pickExperimentModel` рядом с `simpleHash` `:2213`), `backend/src/modules/admin/ai-models/ai-models.service.ts` (`startExperiment`/`stopExperiment`/`switchPrimary` — добавить `this.router.refreshCache()`).

**Зависимости:** нет (первая фаза).

**Что НЕ входит:** удаление легаси-кода (Фаза 3), UI (Фаза 4).

**Acceptance:**
- R1: Когда для `taskType` есть `LlmModelExperiment` со `status='running'` и текущее время внутри `[startedAt, endsAt)`, `chooseProviders()` shall вернуть провайдера/модель из `controlModel`/`variantModel` этого эксперимента, а не из обычной цепочки `LlmTaskRoute`.
- R2: Если `meetingId` задан, повторный вызов `chooseProviders()` с тем же `params.meetingId` и тем же активным экспериментом shall вернуть ту же группу (A или B) каждый раз (детерминированность — юнит-тест на ≥2 повторных вызова).
- R3: На выборке из 1000 разных `meetingId` для эксперимента с `splitPercent=30` доля группы B shall быть в диапазоне 20–40% (допуск на разброс хэша — юнит-тест).
- R4: Если активен одновременно и `LlmModelExperiment`, и GEPA `PromptCandidate` для того же `taskType`/`tenantId`, итоговый `experimentGroup` в `AiUsageLog` shall быть `'gepa_candidate'` (regression-тест, не менять существующее поведение `:1538-1544`).
- R5: После `POST .../llm-model-experiments/:id/start` или `.../stop`, следующий вызов `chooseProviders()` (без ожидания минутного крона) shall учитывать новое состояние — тест мокает `refreshCache` и проверяет, что `AdminAiModelsService.startExperiment`/`stopExperiment` его вызывают.
- Закрывает: R1, R2, R3, R4, R5.
- Команды: `bunx vitest run backend/src/modules/ai/services/llm-router.service.spec.ts`, `bunx vitest run backend/src/modules/admin/ai-models/ai-models.service.spec.ts`, `bun run typecheck`.

### Фаза 2 — Backend: вывод из эксплуатации легаси `/admin/experiments`

**Ценность.** Как разработчик, поддерживающий систему, я получаю один источник правды для A/B-тестов моделей, чтобы не путать, какой из двух путей реально работает.

**Файлы (удалить):** `backend/src/modules/admin/services/admin-experiments.service.ts`, `backend/src/modules/admin/controllers/admin-experiments.controller.ts`, DTO-файл (`admin-experiments.dto.ts` — найти точный путь через `get_skeleton`/поиск импорта `StartExperimentSchema`). **Файлы (править):** `backend/src/modules/admin/admin.module.ts` (убрать импорты и регистрацию `AdminExperimentsController`/`AdminExperimentsService`, строки `:14,58,105,131,155` на момент прошлого чтения — перепроверить), `backend/prisma/schema.prisma` (комментарий на `LlmTaskRoute.experiment` → `/// DEPRECATED (2026-07-03) — заменено LlmModelExperiment, см. plans/tz/2026-07-03-llm-model-ab-experiments-real-split.md. Не читать/не писать в новом коде.`; комментарий на `AiUsageLog.experimentGroup` — заменить ссылку на `LlmTaskRoute.experiment` ссылкой на `LlmModelExperiment`).

**Зависимости:** после Фазы 1 (иначе на момент удаления легаси-пути не остаётся вообще никакого работающего A/B — недопустимый разрыв между фазами при поэтапном деплое; если фазы катятся одним PR — порядок неважен, но НЕ катить Фазу 2 в прод без Фазы 1).

**Что НЕ входит:** удаление Prisma-колонки (только комментарий).

**Acceptance:**
- R6: `grep -r "AdminExperimentsService\|AdminExperimentsController" backend/src` shall вернуть 0 совпадений (кроме, возможно, `.spec.ts`, которые тоже удаляются вместе с сервисом).
- R7: `bun run build` (backend) shall завершиться без ошибок после удаления регистрации из `admin.module.ts`.
- R8: Одноразовый скрипт `backend/scripts/patch-check-legacy-ab-experiments.ts` (idempotent, добавить в `apply-prod-deploy.ts` STEPS с `skipBootstrap: true`) shall залогировать WARN со списком `taskType`, у которых на момент прогона `LlmTaskRoute.experiment` содержит `enabled:true` и `endsAt` в будущем — без падения и без изменения данных (только чтение + лог). Повторный прогон — no-op (тот же лог, ничего не меняет).
- Закрывает: R6, R7, R8.
- Команды: `bun run build`, `bun run lint`, `grep -rn "AdminExperimentsService\|AdminExperimentsController\|route.experiment" backend/src | grep -v '.spec.ts'` (ожидается пусто вне явно оставленных deprecated-комментариев).

### Фаза 3 — Frontend: вкладка A/B на странице «Роутинг моделей»

**Ценность.** Как владелец компании, я вижу и запускаю A/B-тест модели там же, где настраиваю саму модель для задачи, вместо поиска отдельного раздела.

**Файлы (создать/перенести, на основе Б2):** `frontend/app/(admin)/admin/ai/routing/[taskType]/ExperimentTabSection.tsx` (новый, портирует структуру `frontend/app/(admin)/admin/experiments/[taskType]/ExperimentClient.tsx` — `MetricsBlock`/`Row`/`RecentCallsList` — и `frontend/app/(admin)/admin/experiments/ExperimentStartDialog.tsx`, источник данных — `adminAiModelsApi.experimentsList/experimentCreate/experimentStart/experimentStop/experimentAnalytics`). **Файлы (править):** `RoutingDetailClient.tsx` — добавить в `TABS` (`:65-69`) пункт `{ value: "experiment", label: "A/B-тест", icon: FlaskConical }` и ветку рендера `active === "experiment"`.

**Зависимости:** после Фазы 1 (иначе кнопка будет создавать эксперимент, который снова никто не читает).

**Что НЕ входит:** изменения в `ChainTabSection`/`switchPrimary`-бандле (см. Scope «Не входит»).

**Acceptance:**
- R9: На вкладке «A/B-тест» страницы `/admin/ai/routing/[taskType]` пользователь shall увидеть форму запуска эксперимента (поля: вариант-модель, вариант-провайдер, % трафика, длительность в днях, заметка) и, при наличии активного/завершённого эксперимента, панель control/variant с числом вызовов/ошибок/средней ценой (аналог легаси `MetricsBlock`).
- R10: `bun run typecheck` и `bun run build` (frontend) shall проходить без ошибок.
- Закрывает: R9, R10.
- Команды: `bun run typecheck`, `bun run build`, ручная проверка через `playwright` (открыть `/admin/ai/routing/summary`, убедиться, что вкладка «A/B-тест» отображается и форма отправляется без 404/500).

### Фаза 4 — Frontend: удаление легаси-страниц `/admin/experiments`

**Ценность.** Как владелец компании, я не вижу в навигации путь, который больше ничего не делает по-своему (после Фазы 2 бэкенд под ним уже удалён).

**Файлы (удалить):** `frontend/app/(admin)/admin/experiments/` целиком (page.tsx, `ExperimentsListClient.tsx`, `ExperimentStartDialog.tsx`, `[taskType]/`), `frontend/src/api/admin-experiments.api.ts`, `frontend/src/domain/admin-experiment.ts` (проверить `grep -rn "admin-experiments.api\|domain/admin-experiment" frontend/src frontend/app` перед удалением — на момент REALITY-CHECK потребителей вне удаляемых файлов не найдено). **Файлы (править):** `frontend/app/(admin)/admin/navigation.ts` — удалить блок `:213-218` (`href: "/admin/experiments"`).

**Зависимости:** после Фазы 2 (бэкенд-маршруты уже должны быть удалены, иначе фронт временно ссылается в никуда до полного деплоя — не критично при едином деплое, но порядок важен при поэтапном).

**Что НЕ входит:** ничего дополнительного — чистое удаление.

**Acceptance:**
- R11: `grep -rn "admin/experiments\|admin-experiments.api\|domain/admin-experiment" frontend/src frontend/app` shall вернуть 0 совпадений.
- R12: `bun run build` (frontend) shall проходить без ошибок битых импортов.
- Закрывает: R11, R12.
- Команды: `bun run typecheck`, `bun run build`, `grep -rn "admin/experiments" frontend/`.

## Pre-mortem / Риски

- **Риск:** во время выката (между Фазой 1 и Фазой 2, если катятся раздельно) на проде есть активный легаси `route.experiment` с `enabled:true` — после Фазы 2 он молча перестанет сплитовать (поле больше не читается), но и не будет мигрирован. **Митигация:** Фаза 2's R8 скрипт логирует WARN до удаления — прогнать вручную ДО деплоя Фазы 2, вручную остановить/пересоздать найденные активные эксперименты в новом UI (Фаза 3 должна быть задеплоена раньше или одновременно).
- **Риск:** `simpleHash` даёт неравномерное распределение на малых выборках (`meetingId` в одной компании может коррелировать). **Митигация:** R3 явно допускает разброс 20–40% при заявленных 30% — не требуем точного попадания.
- **Ревью-аспект для `strict-production-review-gate`:** убедиться, что `activeModelExperiments` фильтруется по `tenantId: null` (глобальные эксперименты, не org-specific) — `LlmModelExperiment.tenantId` опционален, но `chooseProviders()` в этой фиче работает только с глобальными (`tenantId: null`) записями, как и легаси-механизм; org-scoped эксперименты — вне scope (в модели поле для будущего, не для этой фичи).

## Сквозные аспекты

- **RBAC/tenant:** без изменений — `SuperAdminGuard` уже на контроллере; эксперименты в этой фиче — только глобальные (`tenantId: null`), tenant-изоляция не задействуется.
- **Observability:** переиспользовать существующие метрики `incAdminAiModelsExperimentStarted`/`incAdminAiModelsExperimentStopped` (`ai-models.service.ts`) — новых метрик не требуется.
- **Errors/idempotency:** Фаза 2 R8 скрипт — read-only, идемпотентен по определению.
- **Миграция данных:** нет автоматической миграции (см. Scope «Не входит») — только скрипт-предупреждение.
- **Rollout/флаг:** Ship-On, без флага — это чистый рефакторинг видимого поведения админки, не пользовательская фича с денежным риском для конечного клиента (только для super_admin).
- **Тесты:** см. Acceptance каждой фазы.

## Совместимость с prompt caching

Не релевантно — фича не меняет содержимое system/user промптов, только выбор провайдера/модели.

## DoD

- `bun run typecheck && bun run lint && bun run build` зелёные в `backend/` и `frontend/`.
- Все новые/изменённые `.spec.ts` проходят (`bunx vitest run`).
- `second-brain/04_не-сделано/README.md` — строка 283 убрана из «Открыто», перенесена в «Закрытые (архив)» с датой и коммитом.
- `second-brain/01_projects/api-layer.md` (или профильный файл) обновлён — упомянуть удаление `/admin/experiments`, новый эндпоинт-потребитель `/admin/llm-model-experiments`.
- Рефлексия в `second-brain/05_история/`.

## Итог

_Заполняет `tz-orchestrator` по завершении реализации: реализовано ли целиком, какие фазы, что осталось._
