# Orchestrator-prompt: доводка редизайна дашбордов (full dataviz)

Запусти скилл `tz-orchestrator` для реализации ТЗ
`plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md`.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (Ship-On §8, стек Bun+TS, prisma-rules, парные цветовые токены, UI только русский).
2. ТЗ выше — целиком (шпаргалка компонентов `modern/` = канон, копировать пропсы 1-в-1).
3. Анализ статуса: `plans/analysis/2026-06-09-dashboards-redesign-rollout-status.md`.
4. Код-якоря (перечитать перед каждой правкой — номера строк могли сдвинуться):
   - Эталоны «как правильно»: `frontend/app/(authenticated)/dashboard/portfolio/PortfolioDashboardClient.tsx`, `.../value-recap/ValueRecapDashboardClient.tsx`.
   - Библиотека: `frontend/src/ui/components/dashboard/modern/*` (особенно `StatCard.tsx`, `tokens.ts`, `index.ts`).
   - Бэк-паттерн рядов: `backend/src/modules/dashboard/services/sentiment-index.service.ts:147` (`buildSparkline`).
   - Цели миграции: `OperationsDashboardClient.tsx`, `me/MeClient.tsx`, `DirectorDashboardClient.tsx`, `operations/daily/DailyDigestClient.tsx`, `operations/weekly/WeeklyDigestClient.tsx`.

## Инструменты
- vexp `run_pipeline` первым, если демон жив; иначе fallback Grep/Read (демон в этой сессии был НЕ активен — grep не блокировался).
- Context7 только если потребуется свежий API recharts 3.8 (но все графики уже инкапсулированы в `modern/*` — обычно не нужен).

## Граф фаз (волнами)
- **Волна 1 (параллельно):** Ф0 (FE-фундамент: `StatCard`-ext + `ModernPageShell` + `kpiTone`) ∥ Ф1 (BE: `weeklyInflow` для operations overview) ∥ Ф1b (BE: трендовые ряды `trend` в daily/weekly дайджестах из истории `*OperationsDigest` + unit-тесты). Разные файлы/слои — конфликтов нет.
- **Волна 2 (параллельно, после волны 1):** Ф2 (operations, +Ф1) · Ф3 (/me) · Ф4 (director) · Ф5 (daily, +Ф1b) · Ф6 (weekly, +Ф1b) — разные файлы, конфликтов нет.
- **Волна 3:** Ф7 (удалить мёртвый `DashboardClient.tsx` + сквозная QA-приёмка).

После каждой зелёной волны — коммит по фазам, затем следующая волна в том же ответе (без остановок между волнами; push — только с подтверждением владельца).

## Факт-чек (НЕ верить отчёту суб-агента — урок `agents_can_lie_about_edits`)
После каждой фазы — сам прогони grep-предикаты из Acceptance, например:
- `grep -nE "shadcn/card|KpiHero" <файл>` → 0 (для Operations/Director).
- `grep -nE "bg-bg-card|bg-bg-surface|rounded border" <файл>` → 0 (вне OFF-веток kill-switch — их исключения задокументировать).
- `grep -n "from '@/ui/components/dashboard/modern'" <файл>` → нужные компоненты импортированы.
- `grep` по текстам loading/empty/error состояний → сохранены.
- Свой прогон `bun run typecheck && bun run lint && bun run build` (frontend и backend); `bunx vitest run` для Ф1.
- В промпт каждому кодеру: «re-Read файл после каждого Edit; перечитай модель/строки перед правкой; верни `git status` и точные диффы в отчёт».

## Жёсткие границы (НЕ нарушать)
- НЕ трогать OFF-ветки `reworkEnabled` (operations, стр. ~299-324) и `mainReworkEnabled===false` (director, стр. ~356-434).
- НЕ удалять `KpiHero` (живёт в `/teams`, `/persons/pulse`, `KnowledgeVelocityKpi`).
- НЕ трогать уже-мигрированные эталоны (portfolio, value-recap, goals, maturity, actions) и готовые glass-виджеты (`DailyValueSection`, `ChronicBlockersWidget`, `TeamCapacityWidget`, `IdeasSection`, `ChronicBlockersSection`, 4 виджета `/me`).
- Сырой `recharts` в экранах запрещён — только через `modern/*`.
- Новых флагов не вводить; схему Prisma не менять; UI — только русский, парные цветовые токены.

## Определение «фаза закрыта»
Все grep-предикаты Acceptance фазы зелёные + `typecheck/lint/build` (+ vitest для Ф1) зелёные + состояния loading/empty/error сохранены + (для UI-фаз) визуальная приёмка по словарю `/redesign`. «Закрывает: Rn» в ТЗ — отметить `[x]` только после факт-чека.

## Failure-modes
- Если бэк-модель/поле в Ф1 не совпали с ТЗ (имена `BlockerSynthesis`/`EntityLink`/`relationType`) — перечитать `schema.prisma`, исправить по факту кода, пометить расхождение в отчёте (приоритет: код > ТЗ).
- Если миграция секции ломает функциональное состояние — откатить секцию, сохранить состояние, только потом стилизовать.
- Если `StatCard`-ext ломает `/redesign` — проблема в неаддитивном изменении; вернуть опциональность строго аддитивной.

## Прод
Прод-операций нет — `docker compose up -d --build`. Исключение: если в Ф1 добавлен индекс в `postgres-init.sql` → `prod-deploy-log.md` Шаг 5 + строка в чат-инструкции.
</content>
