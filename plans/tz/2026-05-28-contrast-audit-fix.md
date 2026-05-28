---
type: tz
status: done
feature: contrast-audit-fix
date: 2026-05-28
---

# ТЗ: Исправление контрастности и дизайн-токенов (аудит P0–P1)

> Аналитика: аудит произведён агентом в сессии 2026-05-28; полный отчёт — в чате.

## Цель

Устранить 6 категорий проблем контрастности, найденных в ходе аудита frontend-кода:
- Белый текст на белом фоне (bg-white в dark-теме),
- Undefined shadcn-классы (text-muted-foreground и др.),
- Несуществующие токены bg-bg-muted / bg-bg-hover,
- Недостаточный контраст --text-disabled,
- Хардкод в Entity Graph (bg-black, border-white, text-amber-300),
- Светлые *-300 цвета на светлом фоне (calendar, cause-category).

## Scope

**Фаза 1 — конфигурационные фиксы (tailwind.config.ts + tokens.css):**
- [ ] Добавить `foreground`, `background`, `muted`, `input`, `ring` в colors tailwind.config.ts
- [ ] Добавить `bg.muted` и `bg.hover` в секцию `bg` tailwind.config.ts
- [ ] Исправить `--text-disabled` в tokens.css (dark: 0.40→0.52, light: 0.78→0.55)

**Фаза 2 — массовая замена (параллельно):**
- [ ] `bg-white` → `bg-bg-card` во всех 38 файлах (110+ вхождений)
- [ ] Entity Graph: `bg-black/*` → `bg-bg-overlay`, `border-white/*` → `border-border`, `text-foreground` → `text-fg-primary`, `text-amber-300` → `text-warning`
- [ ] Calendar WeekView: `text-red-300` → `dark:text-red-300 text-red-700`
- [ ] BrandVoice modal: `bg-black/40` → `bg-bg-overlay`
- [x] CauseCategoryMapWidget: `text-*-300` → `dark:text-*-300 text-*-700` (cause-category-presentation.ts)

## Карта замен

### tailwind.config.ts — добавить в `colors`:
```ts
foreground: 'var(--text-primary)',
background: 'var(--bg-base)',
muted: {
  DEFAULT: 'var(--bg-subtle)',
  foreground: 'var(--text-secondary)',
},
input: 'var(--border)',
ring: 'var(--accent)',
```

### tailwind.config.ts — расширить `bg`:
```ts
bg: {
  // ... existing ...
  muted: 'var(--bg-subtle)',
  hover: 'var(--bg-subtle)',
},
```

### tokens.css — исправить:
- Dark: `--text-disabled: oklch(0.40 0.012 250)` → `oklch(0.52 0.012 250)`
- Light: `--text-disabled: oklch(0.78 0.008 75)` → `oklch(0.55 0.010 75)`

## Файлы с bg-white (38 штук)

**frontend/src/:**
- `src/ui/components/admin/AdminMeetingCompareSummaries.tsx`
- `src/ui/components/admin/AdminMeetingDetails.tsx`
- `src/ui/components/admin/AdminMeetingsTable.tsx`
- `src/ui/components/admin/AiUsageDashboard.tsx`
- `src/ui/components/admin/ExpiringRecordingsTable.tsx`
- `src/ui/components/admin/IntegrationKeysTable.tsx`
- `src/ui/components/behavior-metrics/BehaviorTeamCard.tsx`
- `src/ui/components/behavior-metrics/MeetingBehaviorSection.tsx`
- `src/ui/components/lobby/GuestNameForm.tsx`
- `src/ui/components/meeting-result-v2/ReportsTab.tsx`
- `src/ui/components/meeting-room/RecordingIndicator.tsx`
- `src/ui/components/quality-score/MeetingQualityScoreSection.tsx`
- `src/ui/components/shared/Modal.tsx`
- `src/ui/concierge/ConciergeVoice.tsx`

**frontend/app/:**
- `app/(authenticated)/admin/ai-models/AiModelsClient.tsx`
- `app/(authenticated)/admin/ai-models/experiments/ExperimentsClient.tsx`
- `app/(authenticated)/admin/feedback/components/TopicDetail.tsx`
- `app/(authenticated)/admin/feedback/components/TopicItemsList.tsx`
- `app/(authenticated)/admin/feedback/components/TopicsFilters.tsx`
- `app/(authenticated)/admin/feedback/components/TopicsTable.tsx`
- `app/(authenticated)/admin/llm-routes/EditRouteDialog.tsx`
- `app/(authenticated)/admin/llm-routes/LlmRoutesClient.tsx`
- `app/(authenticated)/admin/prompts/PromptsListClient.tsx`
- `app/(authenticated)/admin/prompts/[id]/PromptDetailClient.tsx`
- `app/(authenticated)/admin/prompts/[id]/PromptEditor.tsx`
- `app/(authenticated)/admin/prompts/[id]/PromptPreviewModal.tsx`
- `app/(authenticated)/admin/prompts/[id]/PromptVersionsTab.tsx`
- `app/(authenticated)/admin/prompts/experiments/PromptExperimentsListClient.tsx`
- `app/(authenticated)/admin/prompts/experiments/[id]/PromptExperimentDetailClient.tsx`
- `app/(authenticated)/admin/prompts/new/PromptCreateClient.tsx`
- `app/(authenticated)/admin/skill-trait-concepts/SkillTraitConceptsClient.tsx`
- `app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx`
- `app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx`
- `app/(authenticated)/experiments/ExperimentsListClient.tsx`
- `app/(authenticated)/experiments/[id]/ExperimentDetailClient.tsx`
- `app/(authenticated)/me/check-ins/MyCheckInsClient.tsx`
- `app/(authenticated)/me/promises/MyPromisesClient.tsx`
- `app/(authenticated)/settings/organization/InviteCreatedDialog.tsx`

## Файлы с bg-bg-muted / bg-bg-hover (12 штук — решается конфиг-фиксом)

После добавления `bg.muted` и `bg.hover` в tailwind.config.ts классы начнут работать без правки компонентов.

## Файлы с shadcn-классами (18 штук — решается конфиг-фиксом)

После добавления `foreground`, `background`, `muted`, `input`, `ring` в tailwind.config.ts классы начнут работать.

## Entity Graph (2 файла — ручная правка)

`EntityGraphClient.tsx` и `ForceGraphCanvas.tsx`:
- `bg-black/30`, `bg-black/40`, `bg-black/20` → `bg-bg-overlay`
- `border-white/10`, `border-white/5` → `border-border-subtle`
- `text-foreground` → `text-fg-primary` (или оставить после конфиг-фикса)
- `text-amber-300` → `text-warning`
- `hover:bg-black/50` → `hover:bg-bg-subtle`

## Calendar (1 файл — ручная правка)

`WeekView.tsx` строка 126:
- `text-red-300` → `dark:text-red-300 text-red-700`

## Нет фаз

Всё — одна волна после конфига. Порядок:
1. tailwind.config.ts + tokens.css (сначала, дают зелёный свет остальному)
2. bg-white mass-replace (параллельно с 3, 4)
3. Entity Graph fix (параллельно)
4. Calendar fix (параллельно)
5. typecheck

## Итог

Реализовано полностью 2026-05-28 (сессия аудита + фикс).
- Фаза 1 (конфиг): ✅
- Фаза 2 (mass-replace bg-white): ✅ 37/38 (1 остаток намеренный — RecordingIndicator ping)
- Entity Graph: ✅ (text-foreground оставлен — конфиг-алиас работает)
- Calendar: ✅
- BrandVoice: ✅
- CauseCategoryMapWidget: ✅ (добавлено в ходе аудита — было пропущено)
- typecheck: exit 0
