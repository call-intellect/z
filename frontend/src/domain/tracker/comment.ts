/**
 * Доменная модель комментария задачи трекера.
 *
 * Контракт: `backend/src/modules/tracker/services/comments.service.ts`
 * (CommentResponseDto).
 */

export type CommentAccess = 'internal' | 'external';

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface CommentApi {
  id: string;
  issueId: string;
  authorId: string;
  parentCommentId: string | null;
  content: string;
  contentHtml: string | null;
  contentStripped: string | null;
  access: string;
  voiceUrl: string | null;
  voiceDuration: number | null;
  voiceTranscript: string | null;
  mentionedUserIds: string[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  issueId: string;
  authorId: string;
  parentCommentId: string | null;
  content: string;
  contentHtml: string | null;
  contentStripped: string | null;
  access: CommentAccess;
  voiceUrl: string | null;
  voiceDuration: number | null;
  voiceTranscript: string | null;
  mentionedUserIds: string[];
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  // ─ computed ─
  isEdited: boolean;
  isDeleted: boolean;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

const parseAccess = (raw: string): CommentAccess =>
  raw === 'external' ? 'external' : 'internal';

export function commentFromApi(api: CommentApi): Comment {
  const editedAt = parseDate(api.editedAt);
  const deletedAt = parseDate(api.deletedAt);
  return {
    id: api.id,
    issueId: api.issueId,
    authorId: api.authorId,
    parentCommentId: api.parentCommentId,
    content: api.content,
    contentHtml: api.contentHtml,
    contentStripped: api.contentStripped,
    access: parseAccess(api.access),
    voiceUrl: api.voiceUrl,
    voiceDuration: api.voiceDuration,
    voiceTranscript: api.voiceTranscript,
    mentionedUserIds: api.mentionedUserIds ?? [],
    createdAt: new Date(api.createdAt),
    editedAt,
    deletedAt,
    isEdited: editedAt !== null,
    isDeleted: deletedAt !== null,
  };
}
