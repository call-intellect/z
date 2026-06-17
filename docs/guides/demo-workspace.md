# Демо-кабинет «ТехноСтрим» — инструкция

> Как создать полностью заполненную демо-организацию для показа Z клиенту/команде, как ей пользоваться и как сбросить.

## Что это

Демо-кабинет — это вымышленная IT-компания **«ТехноСтрим»** с реалистичными данными во всех разделах продукта. Нужен, чтобы показать Z «как это выглядит в живой компании», не заводя ничего вручную. Все записи помечены `externalSource: 'demo'` — отделяются от боевых данных и сносятся одной командой.

Демо привязывается к **конкретной Org** (`tenantId`) и её владельцу (`ownerUserId`). Это **per-org операция**, а не глобальный seed — в авто-аггрегатор `apply-prod-deploy.ts` не входит, запускается по требованию.

### Что внутри (~4600 записей)

| Раздел | Данные |
|---|---|
| Орг-структура | 12 человек, 7 отделов |
| Трекер | 3 проекта, 38 задач, циклы/спринты |
| Встречи | 7 проведённых встреч с AI-отчётами и транскриптами (разные типы встреч) |
| Граф знаний | 20 IdeaBlock, 15 Entity, 7 Theme + связи |
| Клоны | 4 Employee Clone |
| Операции | 100 check-in'ов, дневные/недельные дайджесты |
| Чат / уведомления | 3 диалога, 10 нотификаций |
| Прочее | карточки, процессы |

Идемпотентность: у `Org` есть флаг `demoWorkspaceSeededAt` — повторная заливка в ту же Org не плодит дубли. Перед перезаливкой делай reset.

## Как создать

### Способ А — через UI (рекомендуется для показа клиенту)

1. Залогинься под **owner** нужной Org.
2. Открой `/onboarding/demo-choice`.
3. Жми **«Загрузить демо»** → данные зальются, редирект на `/dashboard` + автозапуск демо-тура (5 шагов по разделам).

### Способ Б — через админку (Z-Admin)

> Планируется (см. `plans/archive/2026-05-29-admin-demo-workspace-creation.md`). После реализации: super-admin на странице `/admin/demo` выбирает Org из списка и жмёт «Создать демо» / «Сбросить демо» — без CLI и без логина под owner'ом.

### Способ В — CLI (для теста / массового прогона)

```bash
# 1. узнать orgId и ownerUserId:
docker compose exec backend bun -e '
import { createPrismaClient } from "./scripts/_lib/prisma";
const p = createPrismaClient();
console.log("ORGS:",  await p.org.findMany({ select:{ id:true, name:true } }));
console.log("USERS:", await p.user.findMany({ take:5, select:{ id:true, email:true } }));
'

# 2. залить демо:
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId>
```

### Способ Г — через API (если уже есть session-cookie)

```bash
curl -X POST https://api.prod.host/api/v1/orgs/<orgId>/demo-workspace \
  -H "Cookie: <session>" -H "X-Org-Id: <orgId>"
```

## Как пользоваться (что показывать после заливки)

Залогинься owner'ом этой Org и пройди по разделам — везде уже есть данные:

- **`/dashboard`** — пульс компании: метрики, активность, дайджесты.
- **Трекер (проекты/задачи/спринты)** — 3 проекта, 38 задач по статусам, циклы.
- **Встречи** — 7 встреч с готовыми AI-отчётами и транскриптами; видно, как отчёт зависит от типа встречи.
- **Граф знаний / База знаний** — IdeaBlock, сущности (люди/клиенты/документы), темы-кластеры, связи.
- **Сотрудники / Клоны** — 4 Employee Clone: можно задать вопрос «клону» уволившегося/занятого сотрудника.
- **Операции** — 100 check-in'ов, недельные/дневные дайджесты.
- **Чат компании / уведомления** — 3 диалога, 10 нотификаций.
- **Демо-тур** — если зашёл через UI, проведёт по ключевым экранам автоматически.

Смысл: открываешь Z и сразу видишь продукт «как в живой компании», без ручного наполнения — идеально для демонстрации клиенту.

## Как сбросить

```bash
# CLI (удалит ТОЛЬКО демо-данные, помеченные externalSource='demo'):
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId> --reset

# или API (owner only):
curl -X POST https://api.prod.host/api/v1/orgs/<orgId>/reset-demo \
  -H "Cookie: <session>" -H "X-Org-Id: <orgId>"
```

Боевые данные Org при reset не трогаются — удаляется только демо.

## Частые вопросы

- **Можно ли залить демо в боевую Org?** Да, демо изолировано флагом `externalSource='demo'` и снимается reset'ом. Но для показа лучше завести отдельную Org.
- **Что если запустить дважды?** Защита по `demoWorkspaceSeededAt` — повторный прогон без reset не плодит дубли.
- **Где код?** Сервис — `backend/src/modules/onboarding/onboarding.service.ts` (`seedDemoWorkspace`), билдеры — `backend/src/modules/onboarding/demo-data/*`, CLI — `backend/scripts/seed-demo-workspace.ts`.

## Связанное

- Prod-операции — [docs/operations/prod-deploy-log.md](../operations/prod-deploy-log.md) (Шаг 7.8).
- Планы фич — `plans/archive/2026-05-29-admin-demo-workspace-creation.md` (демо из админки).
