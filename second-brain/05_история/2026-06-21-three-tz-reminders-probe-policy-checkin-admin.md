---
date: 2026-06-21
type: reflection
feature: three-tz-reminders-probe-policy-checkin-admin
distilled: false
---

# Рефлексия — три ТЗ за раз: напоминания + политика probe + админ-страница чек-инов

## Что было поставлено

Реализовать три ТЗ как оркестратор (skill `tz-orchestrator`), порядок определить самому, в конце — commit + push в `dev`:
- `plans/tz/2026-06-21-daily-reminders-delivery-fix-and-work-calendar.md` (TZ2, 5 фаз)
- `plans/tz/2026-06-21-probe-trigger-policy-tz.md` (TZ1, 6 фаз, самое большое)
- `plans/tz/2026-06-21-day-signals-admin-ui-field.md` (TZ3, фронт, 3 файла)

## Порядок (определён по логике конфликтов + готовности)

**TZ2 → TZ3 → TZ1.** Обоснование:
1. TZ2 первой: её Ф1 уже была в ветке (`5865a02b`, priorityTier:1), прод-баг доставки, и она делит ~6 бэкенд-файлов с TZ1 (реестр крутилок, сид, `schema.prisma`/миграции, `telegram-task-parser`, feature-flags, prod-deploy-log) — закончив TZ2 целиком, дал правкам TZ1 ложиться поверх без merge-конфликтов.
2. TZ3 второй: крошечная, только фронт, непересекающаяся с бэкендом; бэкенд-предпосылка (`daySignals.*` в реестре+сиде) уже была от родительского ТЗ Ф8 (`75b569ce`).
3. TZ1 последней: самая большая и отдельная по смыслу, на стабильной базе.

## Как решал

Картография (Explore-агенты + прямое чтение якорей) → промпт кодеру → независимая приёмка (греп + re-Read + свой typecheck/lint/тесты) → коммит по фазе. 14 коммитов.

- **TZ2**: Ф3-фундамент `PersonLeave` (модель/миграция/сервис/CRUD) отдельно от Ф2+Ф3-гейта — чтобы оба крона (`daily-checkin-prompt`, `telegram-digest`) получили полный календарный гейт за один проход, а не правились дважды. Ф4 застрявшие задачи (новый `issue.findMany` сделан ПОСЛЕДНИМ — дефолтный мок `[]` не сломал старые цепочки `mockResolvedValueOnce`). Ф5 — feature-flags + prod-deploy.
- **TZ1**: Ф1 крутилки+фикс хардкода; Ф2 `ProbeEvent.notBeforeAt` (грейс, `enqueueProbeEvent` уже умел `delayMs`); Ф3a центральный гейт `policy_silent` в `suggest()`; Ф3b бейдж `needsAttention`; Ф4 `regulation.existence_confirm`→`CurationService.decide`; Ф5 intake.

## Что вышло (верификация)

Все фазы: `tsc --noEmit` = 0, eslint = 0 errors, профильные vitest зелёные (probe-суит 172, PersonLeave-гейт 28+38, regulations 24, intake 16, Ф4-спеки 28). Миграции `person_leave` и `probe_event_not_before_at` применены локально (аддитивные).

## Чему научился (грабли с ценой)

1. **`git add a b nonexistent 2>/dev/null` стейджит НИЧЕГО** — при несуществующем pathspec `git add` падает целиком (exit≠0) и не стейджит ни одного из валидных путей; `2>/dev/null` скрыл ошибку → коммит Ф3b `e64b57f3` взял только фронт, бэкенд осиротел. Вскрылось при разборе git status в конце. Урок: НЕ глушить stderr у `git add`; после каждого коммита сверять `git show --stat` с ожидаемым списком.
2. **Суб-агент гоняет только «свой» каталог тестов** — Ф2-агент прогнал `src/modules/probe/` (145 зелёных), но мой Ф2-правка `block-ingest.worker.ts` сломала `knowledge-core/.../block-ingest.attribution-probe.spec` (`cfg.getDynamic is not a function`, мок cfg = `{}`). Blast-radius правки воркера ≠ его модуль. Урок: после правки общего файла прогонять ВСЕ спеки, которые его конструируют (греп `new <Class>(` по спекам).
3. **Суб-агент списывает падения на «pre-existing» относительно committed-HEAD** — Ф4-агент через `git stash` объявил attribution-probe «pre-existing», но stash оставлял мой уже-закоммиченный Ф2. «Pre-existing» надо мерить от `dev`, а не от текущего HEAD. Проверил `git log dev..HEAD -- <file>` (пусто = не моё) — так отделил настоящие pre-existing (`block-distill.*`, 3 теста) от своего регресса.
4. **vitest на Windows переписывает `.snap` с CRLF** — после прогонов агентов ~40 `__snapshots__/*.snap` стали ` M` (только окончания строк, `git diff` пуст). Откатил `git checkout -- __snapshots__/`. Урок: snapshot-шум не коммитить, проверять `git diff --numstat` (0/0 = только CRLF).
5. **Внутренняя тензия ТЗ — решать как оркестратор, документировать.** В матрице probe `attribution.unresolved_at_ingest` = ОТЛОЖИТЬ (грейс), но в К2 он же в `MACHINE_FILLABLE_REASONS` (silent-сет). Решил: silent-сет БЕЗ attribution (он откладывается грейсом, не глушится) — устранил противоречие, держась выбранного дизайна «central gate» (Проход B, fix-the-class).
6. **`getDynamic(key, env?, default)` не имеет tenant-аргумента** — ТЗ местами писало `getDynamic(key, tenantId)`, но реальная сигнатура `(key, envFallbackKey?, defaultValue?)`; глобальный AdminSetting, не per-tenant. Использовал `getDynamic(key, undefined, fallback)` как везде в коде.

## Осталось / честно
- `second-brain/01_projects/operations.md` не существует — TZ2-нарратив (доставка+рабочий календарь) не размещён в second-brain narrative (операционная правда есть в `prod-deploy-log.md` + `data-model.md` + коде).
- Прод-эффект Ф1 TZ2 (утренний Telegram) и метрика `dropped_policy_silent` — проверяются наблюдением на проде по расписанию ([[feedback_no_golden_ship_and_observe_prod]]).
- 3 pre-existing падения `block-distill.*` (не мои, код идентичен dev) — вне scope.
