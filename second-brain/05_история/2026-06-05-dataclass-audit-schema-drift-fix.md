---
date: 2026-06-05
type: история-сессии
distilled: false
---

# Починка schema drift по `dataClassAudit` (5 ERROR/30мин + латентное падение проекций)

## Что было поставлено
Владелец на проде (meet.crossmark.ru) ждал результата живой встречи — «долго нет информации, работает ли система». Разобрать цепочку видеовстречи по логам/БД, найти проблему. По ходу всплыли 5 повторяющихся ERROR в БД каждые 30 мин — отдельно попросили «отработать». Затем: написать ТЗ, потом реализовать по нему (tz-orchestrator) на ветке `sergdev`.

## Как решал
**Диагностика встречи (diag.ts, read-only прод):** встреча `01KTBK4…` шла 09:52–09:56 с реальными участниками (`numPublishers: 2`), но `recording: null`, транскрипта/отчёта нет, в trace только `room_started → room_finished`. Причина — **хост не нажал «Запись»**: авто-запись стартует только при `meeting.recordByDefault` ([livekit-events.handler.ts:187](../../backend/src/modules/webhooks/livekit-events.handler.ts#L187)); нет записи → нет аудио → пайплайн не запускается. Это by design, проблема только UX (нет сообщения «запись не велась»).

**5 ERROR:** cron `DataClassAuditSnapshotCron` (`*/30`) делает `count({where:{dataClassAudit:{not:null}}})` по 13 проекциям; у 5 (Policy/Process/Regulation/Idea/SkillTrait) колонки в схеме нет → `Unknown argument`. Cron глушит в `try/catch` (debug), но `PrismaService` логирует каждый невалидный запрос сам на ERROR. Глубже: писатели проекций (`specialist-3-1` regulation/process/policy, `specialist-3-6` idea) **безусловно** пишут `dataClassAudit` в типизированный `upsert` → ветка не компилировалась + латентная потеря проекций. Корень — Ф8 (`22446248`) добавила колонку только Insight/Decision.

**Реализация (sergdev, 2 коммита):**
- `dataClassAudit Json?` в 4 модели + миграция `20260605114300_add_dataclass_audit_to_projections`. Docker локально упал → миграцию сгенерил **офлайн**: `git show HEAD:…schema.prisma` → старая схема → `prisma migrate diff --from-schema old --to-schema new --script` (без БД, без shadow). 4 чистых `ADD COLUMN JSONB`.
- Cron: убрал `skill_trait`; вместо `information_schema`-проверок сделал самолечащийся фильтр `modelKeysWithDataClassAudit()` из `Prisma.dmmf.datamodel.models` (PascalCase→camelCase) — проекция без колонки пропускается, ERROR от дрейфа невозможен. Спек на 4 кейса.

## Что вышло
typecheck ✓ (был бы красный до фикса — эмпирическое подтверждение), lint ✓, build ✓, 55 тестов воркеров + 5 целевых ✓. Прод-применение миграции и исчезновение ERROR — не проверено локально (Docker down), доедет `migrate deploy` на выкате.

## Чему научился
- **diag.ts read-only — мощный быстрый разбор прод-инцидента** без админки: `trace`/`chain`/`logs --level ERROR` дают цепочку встречи и стабильные паттерны ошибок за минуты.
- **Prisma 7.8: офлайн-генерация миграции без БД** — `migrate diff --from-schema <file> --to-schema <file> --script`. Флаги переименованы: `--from-schema-datamodel` → `--from-schema`. Спасает, когда Docker/shadow-DB недоступны.
- **DMMF как самолечащийся гард схема↔код:** `Prisma.dmmf.datamodel.models[].fields[].name` доступен статически из `@prisma/client`, без БД — идеален для «пропусти модель без колонки X». Лучше, чем хардкод таблиц + `information_schema`.
- **Симптом в логах (ERROR cron) ≠ весь баг:** под «шумным» симптомом скрывалась некомпилируемость ветки и латентная потеря проекций. Греп писателей поля до выбора лечения окупился — выбрали «+колонка», а не «заглушить cron». [[feedback_fix_the_whole_class_not_the_case]]
- **Правила Prisma сменились 2026-06-05** на версионируемые миграции — `db push` запрещён в коммитах; проверять актуальный skill перед схемой.
