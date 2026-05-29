---
date: 2026-05-29
title: Аудит-фиксы — 4 фазы (Б+В+С) + Admin Subscription UI v2 — 66 коммитов
tags: [аудит, безопасность, биллинг, рефакторинг, оркестрация]
distilled: false
---

# 2026-05-29 — Закрытие аудита 139 коммитов + UI v2 одним рывком

## Что было поставлено

ТЗ `plans/tz/2026-05-29-audit-fixes.md` — итог многоагентного аудита 970 файлов за 3 дня:
- **15 блокеров** (Б1-Б15): 7 P0 (sha256↔argon2 mismatch, MustChangePassword, reset-demo катастрофа, Tochka replay, plain OAuth-токены, self-referral, double-pay race) + 8 P1 (DoS, race подзадач, sprint-cron cap, soft-deleted checklist, rollback createPrismaClient, утечка клон-истории, attributeCurrentOrg guard, Tochka recurring без Invoice).
- **17 high-risk** (В1-В17): Redis KEYS, super_admin bypass, customerCode-сверка, копейки/рубли, RBAC-тесты, fingerprint валидация, idempotency seed-demo, AnswerCache tenant-scope, request-access endpoint и т.д.
- **31 medium** (С1-С31): PII-маскировка, BullMQ для payout, JWK TTL, log + метрики, pg_trgm, advisory locks, cycle-check, defense-in-depth tenantId, Telegram TODO, LLM-router timeout, verify-script email conflicts.

Поверх — параллельное ТЗ `plans/tz/2026-05-29-admin-subscription-ui-v2.md`: чистый frontend на 4 фазы (унификация табов, action-кнопки на инвойсах, диалоги adjust-seats/force-status, timeline событий).

## Как решал

**Стратегия — оркестрация фазами с фактчеком после каждой:**

1. **Фаза 0:** ветка `fix/audit-2026-05-29` от `dev`, UI guard reset кнопки (был уже в ef0cd60).
2. **Фаза 1 (Б1-Б7)** — последовательный агент 7 P0 блокеров, каждый отдельным коммитом. После — фактчек grep'ом маркеров `argon2`, `MustChangePasswordGuard`, `no_demo_to_reset`, `maxAge`, `crypto.encrypt`, `SelfReferralDeniedError`, `@unique triggerInvoiceId`. **Найдена дыра:** агент не закоммитил Б7 (race billing), хотя файлы был готовы. Дочинил вручную — `23acf56`.
3. **Фаза 2 (Б8-Б15)** — один агент 8 блокеров. 8/8 DONE. Архитектурные решения (lock-ordering для advisory locks, `dateBucket String?` nullable для совместимости, RbacService через `@Optional` в conversations.service) — приняты агентом и заверены мной.
4. **Фаза 3 (В1-В17)** — один агент 17 high-risk. 15 DONE + 2 SKIPPED (В6 уже в Б1; В16 AnswerCache уже tenant-scoped — verified grep'ом ключа `dlg:ans:{tenantId}:{userId}:{hash}`).
5. **Фаза 4 (С1-С31) + UI v2 (4 фазы)** — **параллельный запуск двух агентов** (backend medium + frontend tab-unification). Файловые конфликты исключены разделением backend/frontend.

**Итого 22 регрессии в тестах** после смен логики С14 (defense-in-depth tenantId), С18 (advisory lock в complete), `feat(onboarding-v2)` чужой сессии, ребренда Z→Кора. Запустил агента-починщика: только моки и ожидания, функционального кода не трогал (кроме одной симметричной добавки в `entity-resolution.service.ts` W3.4 — pre-existing gap).

**21 унаследованный lint error в demo-data/* починил сам:**
- 6× `as any` в `knowledge-graph.ts` → импорт enum-типов из `@prisma/client` + `as SignalType/IdeaBlockLinkType/EntityType/EntityLinkType/ThemeBranch/ThemeDynamic`.
- 8× unused `SeedContext`/`IdMap` импортов — удалены из файлов где не используются как type-параметры. В `knowledge-graph.ts`, `tracker.ts`, `polish.ts`, `operations.ts` оставил их (там реально используются в сигнатуре функций).
- 5× unused helpers `issueId`/`labelId`/`stateId`/`boardId`/`cycleId` в `tracker.ts` — удалил, потому что внутри файла используется прямой `ids.X[k]!`, не helpers.
- 2× unused vars (`_ids`, `_WORKDAYS`) — префикснул подчёркиванием.

## Что вышло

**66 коммитов в `fix/audit-2026-05-29`** (4 из них docs/plans от параллельной сессии про Z Agents/геймификацию — приехали через auto-pull, не моё):
- 30 `fix(audit)` Б+В (Фазы 1-3)
- 24 `fix(audit) С*` + 4 `feat(admin-sub-ui)` (Фаза 4 параллельно с UI v2)
- 6 `fix(tests)` + `fix(audit)` починка регрессий
- 1 `fix(audit) W3.4` (pre-existing gap в entity-resolution)

**Финальный прогон:**
- Backend: `typecheck` ✓, `lint` ✓ (0 errors, 99 warnings — все import-x/order наследие), `test:unit` ✓ (2585 passed / 30 skipped / **0 failed**).
- Frontend: `typecheck` ✓, `lint` ✓ (0 errors), `test:unit` ✓ (111 passed / **0 failed**).

**Прод-операции зафиксированы в `docs/operations/prod-deploy-log.md`** новым блоком «🛡 2026-05-29 — Audit-fixes + Admin Subscription UI v2»:
- 2 новых опц. ENV (LLM_ROUTER_DISPATCH_TIMEOUT_MS, TELEGRAM_PROXY_PING_TIMEOUT_SEC).
- 4 новых `@unique`/composite в schema (Б4, Б7×2, Б8). **Требуют dedupe-patch ДО `prisma:push`**.
- 1 новое в `postgres-init.sql` (pg_trgm + Cycle_name_trgm_idx).
- 7 новых patch-скриптов (rehash, mark-demo, encrypt-tochka, dedupe×2, backfill-date-bucket, audit-email — последний dry-run-only).

## Чему научился

1. **Агенты лгут про [x] и про `git add`.** Заявленный «DONE 7/7» Б1-Б7 в реальности был 6/7 — Б7 файлы готовы, коммит забыт. **Каждый отчёт верифицирую grep'ом и `git log`.** Также Агент A в Фазе 4 нарушил правило про `git add` и засосал staged-индекс Агента B (frontend Фаза 2) в свой коммит `be5735b`. Файлы корректные, история кривая. **Будущее правило:** перед `git add` в промпте агенту — *обязательный* `git diff --cached --name-only` с явным фильтром «только мои пути».

2. **Параллельные сессии Claude вмешиваются в мою ветку.** Чужие `0c42940`, `5abec93`, `b669d90`, `a543730` приехали через `post-push-reflection.py` auto-pull. Не моё, но в моём `git log dev..HEAD`. **В PR description явно указать что docs/plans — не относятся к аудиту.**

3. **Параллельные агенты — экономия в 2× для независимых слоёв.** Backend Фаза 4 + frontend admin-sub-ui v2 — 30 минут вместо 60. Конфликтов в файлах не было (разные слои), конфликт только в `git add` гигиене.

4. **22 регрессии в тестах — норма после крупных аудит-фиксов.** Большинство — не мои (чужая логика, ребренд, изменения onboarding-v2). Прицельное обновление моков работает: defense-in-depth добавил `tenantId` поле — `mockResolvedValue({..., tenantId: 't-1'})` достаточно.

5. **«Всё зелёное» — это финальное обещание, не "наладится потом".** Сначала 21 lint error казались наследием f177ef2 (старого commit) — но пользователь требует чистоты, и решение «`as PrismaEnum` + удалить unused» закрывает их за 15 минут. Не откладывать.

6. **Решения на развилках — фиксировать в отчёте.** Каждый агент в архитектурных пунктах писал «### Архитектурные решения» с обоснованиями (BullMQ в main-процессе vs отдельный worker, `Step.requireFlag` vs `skipBootstrap+skipUpdate` для incident-only, `dateBucket String?` nullable для backward-compat). Это позволяет мне-оркестратору не ревьюить каждую строку, а только проверить логику решения.

## Ссылки

- ТЗ: [plans/tz/2026-05-29-audit-fixes.md](../../plans/tz/2026-05-29-audit-fixes.md)
- UI ТЗ: [plans/tz/2026-05-29-admin-subscription-ui-v2.md](../../plans/tz/2026-05-29-admin-subscription-ui-v2.md)
- Prod-инструкция: [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md) — блок «🛡 2026-05-29 — Audit-fixes»
- 66 коммитов: `git log --oneline dev..HEAD` в ветке `fix/audit-2026-05-29`.
