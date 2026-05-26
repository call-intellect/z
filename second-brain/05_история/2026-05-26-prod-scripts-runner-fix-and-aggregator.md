---
date: 2026-05-26
type: рефлексия
session: фикс prod-runner для scripts/ + агрегирующий apply-prod-deploy.ts
distilled: false
---

# Рефлексия — prod-runner-образ был непригоден для запуска scripts/, плюс агрегатор всех deploy-операций

## Что было поставлено

Пользователь по обновлённой prod-инструкции wipe-deploy'нул сервер. Дойдя до Шага 14 (seed-скрипты) упёрся:

```
docker compose exec backend bun run scripts/seed-default-llm-providers-and-models.ts
error: Module not found "scripts/seed-default-llm-providers-and-models.ts"
```

После первого фикса (копировать всё `scripts/` в runner — было только 2 файла) поехали следующие ошибки:

```
error: Cannot find module '../src/modules/ai/services/model-prices'
PrismaClientInitializationError: needs to be constructed with non-empty PrismaClientOptions
```

И пользователь попросил агрегатор: «1 коммандой можно было все обновлять и зафиксируй это в мозгах».

## Как решал

### Слой 1 — Dockerfile runner-образа

Было: копировался только `scripts/apply-postgres-init.ts` + `scripts/postgres-init.sql`. Остальные 112 файлов оставались в builder-стадии. Плюс `src/` вообще не было в runner — только `dist/` после tsc.

Стало:
```dockerfile
# Скомпилированный код
COPY --from=builder /app/dist ./dist
# src/ для скриптов, которые импортируют '../src/...'
COPY src ./src
COPY tsconfig.json ./
# Все prod-скрипты
COPY scripts ./scripts
```

В `.dockerignore` добавлены exclude для тяжёлого dev-only: `scripts/eval/` (584 KB бенчмарков), `scripts/__snapshots__/`, `scripts/benchmark-*.ts`, `scripts/e2e-*.ts`. `*.spec.ts` уже были исключены.

Размер runner-образа +5-10 MB к предыдущему — приемлемо.

### Слой 2 — PrismaClient adapter helper

В Prisma 7 голый `new PrismaClient()` падает: нужен driver adapter (`@prisma/adapter-pg`). У `PrismaService` в Nest он есть, но 82 скрипта инстанцировали клиент напрямую.

Создан `backend/scripts/_lib/prisma.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export function createPrismaClient(): PrismaClient {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('[_lib/prisma] DATABASE_URL не задан');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
}
```

Sed-патч 82 скриптов в 2 этапа:
1. Сначала точный паттерн `^const prisma = new PrismaClient();` (62 файла, top-level).
2. Затем общий `new PrismaClient();` (любой отступ, имя переменной — 20 файлов в `main()` функциях).

Условие на добавление импорта: если файл ещё НЕ содержит `createPrismaClient`. После патча — 0 raw `new PrismaClient();`, 82 файла с `createPrismaClient()`.

Остальные ~11 скриптов уже передавали options (`new PrismaClient({ adapter: ..., log: ... })`) — их не трогал.

### Слой 3 — Агрегирующий скрипт

`backend/scripts/apply-prod-deploy.ts` — один точкой входа для всех ~80 prod-операций:

```bash
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap   # чистый старт
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update      # обновление prod
docker compose exec backend bun run scripts/apply-prod-deploy.ts                    # all (по умолчанию)

# Флаги: --dry-run, --continue-on-fail
```

Архитектура: массив `STEPS: Step[]` со всеми скриптами. Каждый Step имеет `phase` (bootstrap-admin / seed-llm-core / seed-base / seed-llm-routes / seed-llm-default / patch / backfill / migrate) и опц. флаги `skipBootstrap` / `skipUpdate`. Выполнение через `Bun.spawn(['bun', 'run', script, ...args])` с `stdout/stderr: inherit` — пользователь видит логи каждого скрипта в реальном времени.

В конце — summary: `Всего: N, OK: M, FAIL: K` + список упавших. Если есть фейлы — `exit 1`.

### Слой 4 — Зафиксировать правила

`CLAUDE.md` → раздел «Триггер 1: после `git push`» → Шаг 5 рефлексии — добавлены **3 правила** для будущих сессий:

1. **Агрегатор.** Все новые `seed-*` / `patch-*` / `backfill-*` / `migrate-*` скрипты обязательно регистрировать в `apply-prod-deploy.ts` → массив `STEPS`. Без этого на проде не запустятся.
2. **PrismaClient.** В скриптах — только `createPrismaClient()` из `_lib/prisma`. Никогда не писать `new PrismaClient()`.
3. **Импорты `../src`.** В скриптах разрешено импортировать из `../src/modules/...` — Dockerfile это поддерживает.

`docs/operations/prod-deploy-log.md` → в начале добавлен раздел «🚀 TL;DR — одна команда» с примерами вызова агрегатора. Существующие подробные Шаги 6-9 сохранены — на случай если нужно запустить конкретный скрипт вручную.

## Что вышло

- `backend/Dockerfile`: +`COPY src ./src` + `COPY tsconfig.json ./` + `COPY scripts ./scripts` (вместо двух отдельных файлов).
- `backend/.dockerignore`: exclude для `scripts/eval/`, `scripts/__snapshots__/`, `benchmark-*.ts`, `e2e-*.ts`.
- `backend/scripts/_lib/prisma.ts`: helper `createPrismaClient()`.
- 82 скрипта пропатчены sed'ом на использование helper.
- `backend/scripts/apply-prod-deploy.ts`: агрегатор на ~150 строк с режимами `bootstrap` / `update` / `all`.
- `docs/operations/prod-deploy-log.md`: TL;DR-блок с агрегатором в начале.
- `CLAUDE.md`: 3 новых правила в Шаге 5 рефлексии.

## Чему научился

### Главное правило

> **Prod-runner Dockerfile должен содержать ВСЁ что нужно для prod-операций, не только runtime.** Раздельные runtime/operations-окружения создают bus-factor: оператор приходит на прод, копирует команды из `prod-deploy-log`, они падают «Module not found». Это хуже чем образ +10 MB.

### Грабли для будущих сессий

1. **Prisma 7 driver adapter — обязателен везде.** Не только в `PrismaService` в Nest, но и в любых `new PrismaClient()` в скриптах. Без adapter — `PrismaClientInitializationError`. Использовать `_lib/prisma.createPrismaClient()`.
2. **Sed-патч с двумя проходами** (точный паттерн → общий) лучше чем один общий regex: первый проход покрывает 70-80% быстро и предсказуемо, второй догоняет вариации с отступами.
3. **Агрегирующий скрипт обязан быть source of truth.** prod-deploy-log.md существовал, но команды в нём копипастились вручную — оператор делает 0 шагов или 80, промежуточных состояний нет. Скрипт с массивом `STEPS` обеспечивает: (а) единый порядок, (б) ничего не забыто, (в) добавление нового файла = добавление одной строки в массив.
4. **`.dockerignore` важен.** Без него `COPY scripts ./scripts` тянет 584 KB бенчмарков и snapshot-fixture'ов в prod-образ. Exclude для `scripts/eval/`, `scripts/__snapshots__/`, dev-only паттернов.
5. **Зафиксировать правило в CLAUDE.md важнее чем добавить запись в prod-deploy-log.** Шаг рефлексии в CLAUDE.md читается каждый раз агентом, файл deploy-log — только оператором при выкате.

### Что НЕ сработало бы

- Bun preload monkey-patch для PrismaClient. Static imports разрезолвлены до preload — нельзя перехватить.
- Только sed без helper: повторение adapter-init во всех 82 скриптах — много дубликата, при изменении API (например adapter имя поменяется) — править 82 файла.
- Только сделать scripts/ копируемой в runner без агрегатора. Оператор продолжит копипастить 80 команд по одной и пропускать строки. Нужен оба слоя: и образ, и единая точка входа.

## Ссылки

- `backend/scripts/apply-prod-deploy.ts` — агрегатор.
- `backend/scripts/_lib/prisma.ts` — PrismaClient-helper.
- `backend/Dockerfile` — runner теперь копирует src/+scripts/+tsconfig.json.
- `docs/operations/prod-deploy-log.md` → раздел «🚀 TL;DR — одна команда».
- `CLAUDE.md` → Триггер 1 рефлексии → Шаг 5 (3 новых правила про агрегатор, PrismaClient, импорты).
- Предыдущая рефлексия [[2026-05-26-prod-deploy-docker-compose-revision]] — переписали prod-deploy-log на compose-формат.
