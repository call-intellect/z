---
date: 2026-05-30
title: «Привести всё к одному dev» — cleanup веток + paired-tokens + untracked-разбор
distilled: false
---

# 2026-05-30 — Привести git к одному состоянию

## Постановка

Пользователь: «у нас есть `dev` и `sergdev` (на самом деле `sergdev`), плюс другие. Посмотреть, протестировать, всё слить в `dev`, чтобы нигде ничего не оставалось».

На входе:
- Локальная `dev` ≈ `origin/dev`.
- `sergdev` отстаёт ~70 коммитов, имеет 1 уникальный коммит (`8b796b1` — убрать «Экономика»/«152-ФЗ» из сайдбара).
- `origin/telegram` — 2 уникальных коммита (auto-register бота при updateToken).
- `fix/audit-2026-05-29` — уже целиком в dev.
- 8 `worktree-agent-*` веток-мусора от Agent isolation.
- **44 модифицированных frontend-файла** локально (одна волна paired-color-tokens).
- ~60 untracked: docs/plans/skills/scripts/screenshots/cache.

## Как делал

**Фаза 1 — безопасная чистка.** Удалил `fix/audit-2026-05-29` (уже в dev), снёс git-метаданные 8 `worktree-agent-*`. Каталоги на диске остались — Windows заблокировал их через `argon2.glibc.node` (native module внутри worktree's `node_modules`).

**Фаза 2 — чужие коммиты в dev.**
- `sergdev/8b796b1` → cherry-pick **вышел empty** (`SettingsSidebar.tsx` уже не содержит «Экономика»/«152-ФЗ» в dev — кто-то убрал тем же diff'ом ранее). Пропустил.
- `origin/telegram/c147341 + acb340d` → cherry-pick прошёл (auto-merge `prod-deploy-log.md` без конфликта).

**Фаза 3 — локальная работа.** Прогнал typecheck (зелёный), застейджил 44 файла явным списком, закоммитил одним `refactor(frontend): paired color tokens`. Untracked-зоопарк разбил на 5 групп через AskUserQuestion и закоммитил тематическими коммитами: `.gitignore` для кэша/скриншотов, docs, harness, dev-bootstrap-скрипты.

**Фаза 4 — push + удаление веток.** Запушил 7 коммитов, снёс `origin/sergdev`, `origin/telegram`, `origin/fix/audit-2026-05-29` и локальную `sergdev`.

## Результат

- Локально и в `origin`: остались только `dev` и `main`.
- HEAD на dev = `b696b4b`, working tree clean.
- 7 новых коммитов в dev (за эту сессию):
  - `8ef26a9` feat(telegram): auto-register бота при updateToken (cherry-pick)
  - `03e926c` docs(second-brain): рефлексия — auto-register (cherry-pick)
  - `90b23ac` refactor(frontend): paired color tokens (44 файла)
  - `cb83b2e` chore(repo): .gitignore harness/cache/debug
  - `3df78d8` docs(plans,second-brain,marketing): backlog + TZ + processes + landings
  - `18f2e7f` chore(harness): Claude Code hooks + custom skills
  - `b696b4b` chore(dev): audit-bootstrap + design-preview + utils

## Уроки

1. **cherry-pick может выйти empty.** Если diff одной ветки уже применён в целевой — git предложит `--skip`. Перед удалением «отстающей» ветки cherry-pick'ом проверь, что её уникальный контент действительно нужен — может уже быть.

2. **Windows + native node-modules в worktree.** При `git worktree remove --force` файлы вроде `argon2.glibc.node` могут оставаться залоченными. Git-метаданные очищаются (`git worktree list` пустеет), но физические каталоги остаются. Лечится перезагрузкой или явным kill процесса. Не паниковать — это не блокирует git-операции.

3. **PowerShell внутри Bash на Windows — конфликт по `$`.** Bash интерпретирует `$variable` как свою. Решение: класть PowerShell-код в `.ps1` файл и вызывать `powershell -File путь/к/файлу.ps1`. Пути с backslashes тоже глючат — использовать forward slashes.

4. **Параллельная сессия — норма.** Пока я работал, другая сессия запушила `8db743f fix(billing,docs)`. Hook `post-push-reflection.py` сам подтянул это в локальный dev (auto-pull). Видно из `git log --since="30 minutes ago"`. Не пугаться — продолжать (если темы не пересекаются).

5. **AskUserQuestion для untracked-зоопарка лучше, чем угадывание.** 60 файлов — это 5 разных тематических групп. Машина не может надёжно угадать «это кэш или важная заметка»; правильнее показать классификацию и спросить раз. Особенно когда есть feedback «Untracked файлы, появившиеся ДО сессии — не трогать».

6. **Dev-only patch-скрипты с хардкод-паролем — отдельный класс риска.** `patch-create-dev-audit-user.ts` коммитит в git пароль `AuditDev2026!` и `isSuperAdmin=true`. Допустимо, но требует явной коммуникации — спросил пользователя. Альтернатива: читать из `AUDIT_DEV_PASSWORD` ENV с фолбэком.

7. **Cherry-pick'нутые коммиты могут уже содержать prod-deploy-log записи.** Не нужно дублировать в prod-инструкцию — проверяй `git show --stat <hash>` на наличие изменений `docs/operations/prod-deploy-log.md`.
