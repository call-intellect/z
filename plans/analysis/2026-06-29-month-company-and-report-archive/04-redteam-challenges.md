---
type: analysis
status: research-input
feature: month-company-and-report-archive
date: 2026-06-29
snapshot_date: 2026-06-29
source: adversarial red-team (independent retrieval over code + web)
---

# 04 — Состязательный второй проход (red-team)

Независимый агент с собственным retrieval опровергал 4 ключевых решения. Вердикты: 2 escalate (→ владелец, закрыто), 1 revise (учтено), 1 survives.

## #1 — Модель: новая `MonthlyOperationsDigest` vs расширить `ValueRecapSnapshot` → **escalate**

**Атака (steelman расширения ValueRecap):** запрет метрик `assertNoForbiddenMetricKeys` ([value-recap.scoring.ts:74-119](../../../backend/src/modules/operations/services/value-recap.scoring.ts)) проверяет **имена ключей**, не значения; `verdictjson`/`letterjson`/`goalalignmentmonthjson` не содержат запрещённых подстрок, `score` даже в allow-list → три nullable-поля технически кладутся без срабатывания гарда. ValueRecap уже имеет `periodYm`+`@@unique`+`deliveredAt`+`openedAt`+крон 1-е число+доставку+навигатор — 80% близнеца бесплатно.
**Контр-довод (в пользу новой модели):** payload value-recap семантически = «витрина пользы владельцу» (title «что сделала Кора»), герой-месяц = «executive-вердикт траектории» («куда идём») — **разные артефакты, разная аудитория**; смешать = перегруз payload двумя контрактами + конфликт `value-recap-narrative` (maxTokens 400, 2-4 предложения) с письмом-прозой по секциям. Working Backwards: месяц как отдельный артефакт оправдан.
**Решение владельца:** новая модель `MonthlyOperationsDigest`.

## #2 — Сведение 4 недельных снапшотов одним LLM-проходом → **revise**

**Атака:** паттерн недели не масштабируется «в лоб». `buildWeekPackage` ([weekly-digest.service.ts](../../../backend/src/modules/operations/services/weekly-digest.service.ts)) кормит LLM **компрессом** (`select {dateLocal, shortSummary, verdictJson}`, НЕ `letterJson`). Месяц же из 4 недельных `letterJson` (массив прозы, генерится `maxTokens 8000`) — на порядок больший вход → риск переполнения/деградации.
**Контр-довод:** «свести ~20 дневных» хуже (20 > 4), «пересчёт с нуля» дублирует агрегацию — рекомендация свести **недельные** верна, но требует: (1) **компресс-вход** (verdict + shortSummary + ключевые метрики, не полные письма), (2) **`missingWeeks[]` graceful degradation** (новый Org / пропущенный крон → `verdictJson=NULL`).
**Учтено** в архитектуре синтеза (п.2, 99-synthesis).

## #3 — Навигатор inline + лёгкий архив vs отдельная страница «Архив» → **survives**

**Атака:** «не делать» отпадает (месячный герой ретроспективен, без навигатора нет сравнения траектории — MBR требует тренд). «Отдельная страница Архив» — overkill для раннего пилота (~4 юзера, прод почти пуст → пустой экран). Inline уже доказан: `ValueRecapDashboardClient` selectedPeriod + PeriodSelector + `shiftPeriodYm(±1)` — 1:1 переиспользуемо.
**UX-довод (web):** для дашбордов, открываемых реже 1×/нед, пользователи забывают навигацию → статичные виды с явными подписями + default «последний завершённый» работают лучше (effectivePeriod = selectedPeriod ?? domain.periodYm уже сделано).
**Вердикт устоял:** inline-навигатор + лёгкий список, явные подписи периода, default последний.

## #4 — Герой над canvas на `/month` vs инлайн-таб в switcher на `/dashboard` → **escalate**

**Атака:** недельное ТЗ переносит недельного героя на `/dashboard` под rhythm-switcher День↔Неделя(↔Месяц-disabled), **не удаляя** `/week` и `/month` (TZ:107). Если месяц-героя положить на `/month` — он окажется на роуте, который недельное ТЗ метит как назначение disabled-таба «Месяц» (TZ:104) → риск тройной поверхности (`/dashboard`-switcher + `/week` + `/month`).
**Развилка:** (A) месяц = таб switcher на `/dashboard` (единая поверхность, дорого — герой+канва инлайн); (B) таб «Месяц» switcher = ссылка-переход на `/month` с героем-над-canvas (две поверхности, дёшево). Owner-решение, не auto.
**Решение владельца:** B — герой над canvas на `/month`, таб ведёт ссылкой. Зависимость: финал недельного ТЗ.
