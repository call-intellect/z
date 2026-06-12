'use client';

/**
 * MobileAskClient — мобильный экран «Спросить»: AI-вопрос по памяти компании
 * (B4/Ф5 `2026-06-11-remaining-handoff-finishable-now.md`; полный контракт —
 * `2026-06-11-mobile-cora-exec-manager.md` §Ф5).
 *
 * ВЫБОР ЧАТ-КОМПОНЕНТА: переиспользуем `OrgChatPanel`, а НЕ десктопный
 * `ChatV2Client`. Причина: `ChatV2Client` — master-detail в две колонки
 * (sidebar диалогов 320px + поток), что не вмещается в мобильный viewport.
 * `OrgChatPanel` — самодостаточная панель в один столбец (история + ввод +
 * citations chip-ссылками на встречи), уже used inline на дашборде. Логику
 * отправки (`sendOrgChatWithFallback`) и citations НЕ дублируем — берём как
 * есть. Промпт-кнопки и голос-ввод подключаем АДДИТИВНЫМИ опц. пропсами
 * `suggestedPrompts`/`voiceInput` (дефолт-off, десктоп не затронут).
 *
 * Ответ — ТОЛЬКО текст с citations (как на десктопе). Голос только на ВВОД
 * (ASR Vox через `VoiceInputButton`); никакого голосового вывода/озвучки
 * (см. [[concierge_text_only_output]]).
 *
 * Промпт-набор зависит от роли (`askPromptsForRole`): exec (owner/admin) видит
 * управленческие вопросы, остальные — «как у нас принято» и решения.
 */

import { MessageCircle } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { OrgChatPanel } from '@/ui/components/chat/OrgChatPanel';
import { askPromptsForRole } from './ask-prompts';

export function MobileAskClient() {
  const { currentOrgRole } = useAuth();
  const prompts = [...askPromptsForRole(currentOrgRole)];

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-4 py-5">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg-primary">
        <MessageCircle size={20} className="text-accent" aria-hidden />
        Спросить
      </h1>
      <p className="mb-4 text-sm text-fg-secondary">
        Кора ответит по памяти компании — с цитатами из источников.
      </p>

      <OrgChatPanel
        className="min-h-0 flex-1"
        suggestedPrompts={prompts}
        voiceInput
        placeholder="Спросите Кору о памяти компании…"
      />
    </div>
  );
}
