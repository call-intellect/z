export interface AiParticipantContext {
  livekitIdentity: string;
  displayName: string;
  userId: string | null;
  fullName: string | null;
  role: 'host' | 'guest';
}

export function formatParticipantsForPrompt(participants: readonly AiParticipantContext[]): string {
  if (participants.length === 0) return '';
  return participants
    .map((p) => {
      const name =
        p.fullName && p.fullName !== p.displayName
          ? `${p.displayName} (${p.fullName})`
          : p.displayName;
      const userIdRepr = p.userId ?? 'null';
      return `- "${name}" (userId=${userIdRepr}, role=${p.role})`;
    })
    .join('\n');
}

export const PARTICIPANT_IDENTIFICATION_RULES = `Правила идентификации исполнителя:
- Если в речи прозвучало имя, точно совпадающее с участником из списка с непустым userId, в поле "assigneeUserId" верни ИМЕННО этот userId (не выдумывай чужие).
- Если совпадений >1 (например, два «Сергея» в списке) или имя — это роль/команда («маркетинг», «продажи») — assigneeUserId = null.
- Если исполнитель — гость (userId=null в списке) — assigneeUserId = null, оставляй только assigneeRaw.
- assigneeRaw возвращай ВСЕГДА — это исходная фраза из транскрипта (для UI fallback и аудита).`;
