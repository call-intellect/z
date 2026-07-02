---
date: 2026-07-01
feature: goals-engine-consolidation
tz: plans/tz/2026-06-29-goals-engine-consolidation.md
branch: work/2026-06-29
distilled: false
---

# Рефлексия — Движок целей: консолидация (Ф1–Ф9)

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-06-29-goals-engine-consolidation.md` целиком как tz-orchestrator: навести порядок в машинерии целей, ничего ценного не выключая. 9 фаз: время по Москве + порядок ночи (Ф1), вектор людей без обещаний (Ф2), ручные цели как AI (Ф3), суточная пересборка иерархии (Ф4), каскад статуса (Ф5), строже промпт извлечения (Ф6), чистка осиротевшего UI + деталь карточки (Ф7), один вердикт движения (Ф8), крутилки в AdminSetting (Ф9).

## Как решал

Оркестрация: на каждую фазу — картография (verify path:line, line-номера ТЗ устарели) → самодостаточный промпт кодеру (general-purpose) → независимая приёмка мной (grep-маркеры + re-Read критичной логики + свой typecheck/build/vitest, НЕ отчёт агента) → коммит по фазе. Непересекающиеся фазы запускал параллельно (Ф4+Ф5 поверх Ф3; Ф6+Ф7+Ф8) — доказав дизъюнктность файлов заранее.

Коммиты: Ф1 `a3105ad2`, Ф2 `847182f6`, Ф3 `0ca21279`, Ф4 `7fb361e7`, Ф5 `0ab99174`, Ф6 `a15d73b8`, Ф7 `acf94a56`, Ф8 `12cf5b6f`, Ф9 `35703d4f`.

Ключевые технические решения:
- **Ф2 `goal_work`:** cron отдаёт объективный `issue_closed`, LLM повышает до `goal_work`, когда закрытая задача явно двигает цель (артефакт-kind ⊂ сигнал-kind). Развязал ТЗ-внутреннее противоречие «переименовать issue_closed→goal_work» vs «enum ровно [idea,issue_closed,goal_work] без мёртвых».
- **Ф3 KNN:** параметризованный `$queryRaw` CTE (паттерн `issue-goal-suggest`), `EXISTS (SELECT 1 FROM src)` = no-op при `embedding IS NULL`, `LIMIT` через integer-guarded topK.
- **Ф4:** `wouldCreateCycle` вынесен в util; reparent прямым `prisma.goal.update` (минуя `GoalsService.update`, чтобы не затереть `manualOverride`); Redis NX-lock.
- **Ф5:** доменное событие `goal.status_changed` (как `idea.status_changed`) — исключает цикл модулей goals↔operations.
- **Ф9:** `getDynamic(key, undefined, <const>)`, const оставлен как code-fallback; static `computeStatus` получил `atRiskMargin` параметром; KNN_TOP_K — `Number.isInteger`-guard перед интерполяцией в `$queryRawUnsafe LIMIT`.

## Что вышло

Все 9 фаз зелёные на МОЕЙ проверке (не отчёте агента): backend объединённые прогоны typecheck=0 / build(8GB heap)=0 / vitest — Ф3+Ф4+Ф5 54/54, Ф9 79/79, Ф2 28/28, Ф6 snapshot 4/4; frontend typecheck=0 / lint=0 / `next build`=0. Схема БД не менялась (миграций нет). Закрыл пробел ТЗ: downstream `execution-dashboard` (Файлы-список Ф2 его пропустил) обновлён вместе с enum.

## Чему научился

1. **Граничный контракт может сместиться под ногами.** ТЗ Ф2 строила инвариант «смержить ДО дропа `commitmentStatus`», но соседняя ТЗ (чистка обещаний) УЖЕ выкатила дроп в эту же ветку. Бэкенд компилировался (дроп-автор убрал `select`), но осталось мёртвое (`resolveAttributionField`/`author_coverage`/enum). Урок: при многофазной ТЗ с граничными контрактами — ПЕРВЫМ делом `git log --since` + grep реального состояния, а не доверять «line-номерам на момент написания».
2. **ТЗ-Файлы пропускают downstream-потребителей.** Сужение enum производителя осиротляет метки потребителя (`execution-dashboard` читает `signalsJson`). Для любого enum-сужения — grep по ЗНАЧЕНИЯМ, не только по файлу-производителю. Решил сам (не отложил).
3. **Acceptance-grep ТЗ бывает слишком широким.** `grep commitment_kept ... dashboard/ → 0` ловит `forecaster.commitment_kept_ratio` (другой метрик, вне scope). Разрешил интерпретацией + честно вынес forecaster-хвост в `04_не-сделано` (не расширял scope вслепую).
4. **required-поле в shared-типе ⇒ type-ripple.** `cachedAlignment` стал required в `GoalTreeRenderNode` → сломал `director-dashboard.ts` (тоже строит этот тип). Для required-поля — grep всех конструкторов типа заранее.
5. **Local build OOM.** `bun run build` падает JS-heap OOM на дефолтном heap; `NODE_OPTIONS=--max-old-space-size=8192 bun run build` зелёный — установил это как канон для проверки build на этой машине. typecheck (`tsc --noEmit`) местами тоже OOM → тот же heap-флаг.
6. **Параллель по дизъюнктным файлам экономит время без потери контроля** — но верификацию всё равно гоняю по фазам (grep + re-Read + свой прогон), коммит отдельным per-фаза с явным staging.
