# Orchestrator-prompt — Перенос остатка крутилок ENV → AdminSetting (волны W1-W6)

Ты — `tz-orchestrator`. Ведёшь реализацию `plans/tz/2026-06-21-config-knobs-remaining-waves.md` фаза за фазой силами суб-агентов: картография → точный промпт кодеру → независимая приёмка (греп / re-Read / свой typecheck-lint-build-тесты + гарды конфигурации) → коммит по фазам. Push — по подтверждению владельца.

## Порядок чтения на старте
1. `CLAUDE.md` (§9 крутилки в AdminSetting; §8 Ship-On) + `.claude/CLAUDE.md`.
2. ТЗ `plans/tz/2026-06-21-config-knobs-remaining-waves.md` (контракт).
3. **Обязательно** — `plans/analysis/2026-06-21-tz1-step9-10-config-knobs-blocker.md` (доказанный блокер) и `plans/analysis/2026-06-21-config-knobs-divergence-PLAIN.md` (правило «канон = живое значение»).
4. Скиллы: `core-engineering-standards`, `nestjs-rules`, `safe-seed-rules` (сиды), `frontend-rules` (Фаза 1 dotted-страницы + UI-поля), `strict-production-review-gate`.

## Жёсткий гейт
**Фаза 0 (аудит расхождений + одобрение правила владельцем) — ДО любой волны.** Без прогона скрипта-аудита и подтверждённого правила «канон = текущее живое значение» волны НЕ начинать. Это защита от тихих регрессий (доказано: distill 0.92→0.85).

## Критические инварианты (факт-чек на каждом коммите)
1. **Поведение не меняется** (Ship-On): для каждого переносимого ключа сид и resolveSync-дефолт = текущее живое значение (из аудита Фазы 0). Машинный тест на 2-3 ключа волны: `resolveSync` без admin/ENV → канон.
2. **Гарды зелёные:** `env-classification.guard.spec.ts` + `no-direct-process-env.guard.spec.ts`.
3. **Дубль-сиды устранены:** один ключ — один сид-файл — одно значение (= канон). Грепни каждый ключ волны по всем `seed-*.ts` на дубли.
4. **0 dotted-сирот:** после Фазы 1 сверь ключи всех admin-страниц с реестром (как в Ф2: `comm` ключей страниц vs реестр).
5. **CRON/concurrency остаются в ENV** — только классификация.
6. Сиды идемпотентны (`createPrismaClient`, защита admin-edited), прогон дважды; импорты `../src`; новый сид → `apply-prod-deploy.ts` STEPS + `prod-deploy-log` Шаг 7.

## Факт-чек после каждого суб-агента (НЕ верь отчёту [x])
- Греп ключей волны: реестр + сид + геттер `resolveSync`. re-Read изменённых геттеров.
- **После смены сигнатуры геттера — грепни всех потребителей** `this.cfg.<domain>.<key>` (воркеры/сервисы), убедись, что значение то же.
- Свой прогон: typecheck (вкл `.spec`, `NODE_OPTIONS=--max-old-space-size=8192` — Prisma 7 жрёт память) · lint · build · vitest по затронутому · гарды конфигурации — зелёное ДО коммита.
- Весь `git status --porcelain`; чужие untracked не трогать.

## Порядок фаз (серийно — делят typed-config/реестр/сиды)
Фаза 0 (гейт) → Фаза 1 (фикс dotted-страниц) → W1 KnowledgeCore (+вкл. фикс knowledge-core страницы) → W2 Skill/clone/persona → W3 BetaOps → W4 Tracker/governance → W5 остаток доменов → W6 хардкоды. Каждая волна = отдельный коммит `refactor(config): W# — …`; крупную резать на под-коммиты по поддомену против overload.

## Определение «фаза закрыта»
Все Acceptance-предикаты волны машинно зелёные + `strict-production-review-gate` (фокус: НЕТ регрессий поведения) + поведенческий тест дефолта. Тогда коммит + статус в ТЗ.

## Завершение
После каждой волны: `second-brain/02_architecture/*` (где менялись пороги логики) + профильные `01_projects/*` + `prod-deploy-log` (новый сид, Шаг 7) + рефлексия. Блок «📋 Prod-инструкция»: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Push — по подтверждению владельца.
