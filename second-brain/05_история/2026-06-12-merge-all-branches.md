# 2026-06-12 — Слияние всех открытых веток в одну интеграционную

## Что было поставлено

На GitHub накопилось 5 открытых веток; задача — слить все изменения в одну ветку без потерь и открыть PR в `dev`.

## Как решал

1. **Картография веток.** `git merge-base --is-ancestor` показал, что ветки стэкнуты цепочкой: `finishable-now-2026-06-11` (24) ⊂ `remaining-handoff` (32) ⊂ `svdev` (46) ⊂ обе верхние. Реально разошлись только две: `clone-persona-method-layer` (svdev+10) и `assistant-channels-and-autonomy` (svdev+13).
2. **Интеграционная ветка** `feature/merge-all-2026-06-12` от `assistant-channels-and-autonomy` (самая полная), в неё merge `clone-persona-method-layer` (коммит `427127f5`), затем merge свежего `origin/dev` (`7fb43857`, без конфликтов).
3. **7 конфликтов**:
   - `apply-prod-deploy.ts` — оба seed-алиаса (`conflict-arbiter` + `clone-method`) в STEPS;
   - `knowledge-core.module.ts` — оба импорта (тело модуля авто-смержилось);
   - `probe-dispatcher.worker.spec.ts` — единственный содержательный: обе ветки по-разному расширили `buildProbe`/`makeMocks` (одна — `priority`, другая — `reason`); объединил сигнатуры (`priority = 80, reason = 'decision.confirm_status'`) и сохранил оба новых describe-блока (priority-гейт W0 и CDM-интервью Э3.1);
   - 4 дока-реестра (`feature-flags.md`, `prod-deploy-log.md`, `ai-jobs.md`, `04_не-сделано/README.md`) — union-merge: обе стороны дописывали свои секции/строки таблиц; для таблиц маркеры просто удалены (пустая строка сломала бы markdown-таблицу), для секций добавлен разделитель.
4. В самом `probe-dispatcher.worker.ts` проверил руками, что оба механизма сосуществуют корректно: сначала priority-гейт, потом CDM-байпас formulate.

## Что вышло

- backend: `prisma:generate` (свежая схема) → `typecheck` ✅, `lint` 0 errors, `build` ✅, `test:unit` 4898 passed; 1 падение `ssrf-guard.service.spec.ts` — pre-existing (код в dev с `e85e0ef5`), env-specific: WSL2 не резолвит `[::1]` → «DNS lookup упал» вместо «приватный IPv6».
- frontend: `build` ✅, `typecheck` ✅, `lint` 0 errors, `test:unit` 464 passed.
- Все 5 веток + dev подтверждены как ancestors интеграционной ветки — ничего не потеряно.
- Ветка запушена; PR в `dev` создаёт владелец по compare-ссылке (gh CLI не был установлен/авторизован — поставил arm64-бинарь в `~/.local/bin`, но токена нет).

## Чему научился

- Перед слиянием «кучи веток» первым делом проверять стэкнутость через `merge-base --is-ancestor` — из 5 веток реальных merge-операций оказалось всего две.
- Конфликты в реестрах-доках Z (feature-flags, prod-deploy-log, не-сделано) — почти всегда union: обе стороны только дописывают. Но в markdown-таблицах нельзя заменять `=======` пустой строкой — разорвёт таблицу.
- Стейл `.next/types` от чужой ветки роняет frontend `typecheck` фантомными модулями — лечится обычным `next build` (перегенерирует типы), `rm -rf .next` не обязателен.
