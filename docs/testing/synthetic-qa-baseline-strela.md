# Эталонный синтетический QA-тенант «Стрела» (baseline для функциональных тестов)

**Назначение.** Готовый, наполненный тенант, от которого отталкиваемся в функциональных тестах — чтобы не начинать с нуля: дальше только **добавляем** синтетические данные (недели 3, 4…) и прогоняем проверки поверх уже устоявшегося графа.

## Тенант
- **Название:** `Компания Стрела [QA-test strela-b3905c]`
- **Org id:** `cmr1qbvpx0001pwbwxbgmh1jl`
- **Тег/slug:** `strela-b3905c` / `strela-b3905c-strela`
- **Создан:** 2026-07-01, локальный стенд (Postgres :55435). Только для dev/QA.

## Текущее состояние (снимок 2026-07-01)
| Сущность | Кол-во |
|---|---|
| persons | 11 (7 сотрудников + 4 клиента) |
| meetings | 10 (6 типов) |
| idea_blocks (canonical) | 185 |
| entities | 130 |
| decisions / insights / ideas | 10 / 18 / 21 |
| intake_issues (курация) | 23 |
| goals / themes | 1 / 19 |
| raw_events | 35 |

**Люди:** сотрудники — Сергей (owner), Анна, Михаил, Дарья, Игорь, Елена, Александр; клиенты — Виктор, Наталья, Пётр, Ольга. **Данные:** ~2 недели по всем каналам — встречи, Bitrix, Chatbox, обычные чаты, дневные чек-ины.

## Известные модификации стенда (важно — для чистого демо пере-сеять)
- **S-C3 эксперимент:** сущности **Елена→Игорь намеренно слиты** (клон Елены пуст) — доказательство клон-коллапса. Для чистой демонстрации клонов тенант надо пере-сеять.
- Одна curation-item переведена в `decided` (доказательство accept-флоу).
- Тенанту выданы entitlements/подписка для интерактива (иначе paywall блокирует создание).

## Доступ
- **Заходить через `http://localhost:3001`** (НЕ `127.0.0.1:3001` — иначе session-cookie не держится, т.к. API на `localhost:3000`).
- **Аккаунты-owner тенанта:** `test@kora.local` · `sergey.strela-b3905c@strela.test` (синтетический owner) · `admin@crossmark.ru` (super-admin).
- **Пароли — НЕ в git и не в чат.** Живут в gitignored `/.local-dev-accounts.md` и `/.qa-cabinet.local.json`. (Пароль `test@kora.local` на момент теста был временный/невалидный — рабочий вход был через `admin@crossmark.ru`.)

## Как сеять и наращивать (из `backend/`, только локально — `assertNotProd`)
Скрипты: `backend/scripts/seed-synthetic-company.ts` (неделя 1), `seed-synthetic-company-week2.ts` (неделя 2), `reprocess-stuck.ts` (добивка).

- **Новый тенант с нуля** (создаёт НОВЫЙ org со случайным тегом, печатает org id):
  ```
  cd backend && bun run scripts/seed-synthetic-company.ts
  ```
- **Нарастить существующую «Стрелу»** (добавить неделю в ТОТ ЖЕ тенант — так и продолжаем baseline, НЕ пере-создавая):
  ```
  cd backend && STRELA_ORG=cmr1qbvpx0001pwbwxbgmh1jl bun run scripts/seed-synthetic-company-week2.ts
  ```
- **Добить застрявшие источники** (RawEvents в `received` без блоков):
  ```
  cd backend && STRELA_ORG=cmr1qbvpx0001pwbwxbgmh1jl bun run scripts/reprocess-stuck.ts
  ```
- **Недели 3+:** скопировать паттерн `seed-synthetic-company-week2.ts` → `-week3.ts` с новым контентом, гонять с тем же `STRELA_ORG`.

> Скрипты вливают данные **через реальный конвейер** (RawEvent → segment-builder → block-ingest → специалисты), а не пишут в таблицы напрямую — поэтому после посева нужно дать конвейеру устояться (debounce block-distill 30с, combined 90с/источник).

## Проверка «конвейер устоялся»
```
psql "$DATABASE_URL" -tAc "select processingStatus, count(*) from \"RawEvent\" where \"tenantId\"='cmr1qbvpx0001pwbwxbgmh1jl' group by processingStatus;"
```
Ждать, пока `received` → `processed`; counts выше растут и стабилизируются.

## Предпосылки
- Локальные зависимости: `docker compose -f docker-compose.dev.yml up -d` (Postgres :55435, Redis, MinIO).
- Backend запущен (`cd backend && bun run dev`) — он же гоняет воркеры/cron in-process.
- `DATABASE_URL` из `backend/.env` (`postgresql://z_app:***@127.0.0.1:55435/z_main`).

## Связанное
- План теста: [plans/analysis/2026-07-01-full-functional-test-plan-work-branch.md](../../plans/analysis/2026-07-01-full-functional-test-plan-work-branch.md)
- Отчёты: [Часть 1](../../plans/analysis/2026-07-01-functional-test-report-part1.md) · [Финальный свод](../../plans/analysis/2026-07-01-functional-test-FINAL-summary.md)
- Планы фиксов: `plans/tz/2026-07-01-package-*.md`
