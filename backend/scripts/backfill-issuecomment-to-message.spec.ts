import { describe, expect, it } from 'vitest';

import { type BackfillComment, mapCommentToHistoricalArgs } from './backfill-issuecomment-to-message';

function makeComment(overrides: Partial<BackfillComment> = {}): BackfillComment {
  return {
    id: 'c1',
    authorId: 'author-1',
    parentCommentId: null,
    content: 'тело',
    contentHtml: '<p>тело</p>',
    contentStripped: 'тело',
    access: 'internal',
    authorType: 'human',
    draftState: null,
    cloneConfidence: null,
    groundednessScore: null,
    voiceUrl: null,
    voiceDuration: null,
    voiceTranscript: null,
    thanksUserIds: ['u-thanks'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    editedAt: null,
    deletedAt: null,
    mentions: [{ mentionedUserId: 'u-a' }, { mentionedUserId: 'u-b' }],
    ...overrides,
  };
}

describe('mapCommentToHistoricalArgs', () => {
  it('1:1 перенос полей, clientMessageId=ic:<id>, mentions/thanks/voice сохранены', () => {
    const comment = makeComment({
      voiceUrl: 'https://s3/voice.mp3',
      voiceDuration: 12,
      voiceTranscript: 'привет',
      draftState: 'accepted',
    });
    const args = mapCommentToHistoricalArgs({
      tenantId: 't-1',
      conversationId: 'conv-1',
      comment,
      parentMessageId: null,
    });

    expect(args.tenantId).toBe('t-1');
    expect(args.conversationId).toBe('conv-1');
    expect(args.authorUserId).toBe('author-1');
    expect(args.content).toBe('тело');
    expect(args.contentHtml).toBe('<p>тело</p>');
    expect(args.contentStripped).toBe('тело');
    expect(args.access).toBe('internal');
    expect(args.authorType).toBe('human');
    expect(args.draftState).toBe('accepted');
    expect(args.mentions).toEqual(['u-a', 'u-b']);
    expect(args.thanksUserIds).toEqual(['u-thanks']);
    expect(args.voice).toEqual({
      url: 'https://s3/voice.mp3',
      duration: 12,
      transcript: 'привет',
    });
    expect(args.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(args.clientMessageId).toBe('ic:c1');
    expect(args.parentMessageId).toBeNull();
  });

  it('parentMessageId прокидывается из карты (тред)', () => {
    const comment = makeComment({ id: 'child', parentCommentId: 'parent' });
    const args = mapCommentToHistoricalArgs({
      tenantId: 't-1',
      conversationId: 'conv-1',
      comment,
      parentMessageId: 'msg-parent',
    });
    expect(args.parentMessageId).toBe('msg-parent');
    expect(args.clientMessageId).toBe('ic:child');
  });

  it('Decimal-поля сериализуются строкой; editedAt/deletedAt прокидываются', () => {
    const comment = makeComment({
      cloneConfidence: { toString: () => '0.812' },
      groundednessScore: { toString: () => '0.950' },
      editedAt: new Date('2026-02-02T00:00:00.000Z'),
      deletedAt: new Date('2026-03-03T00:00:00.000Z'),
    });
    const args = mapCommentToHistoricalArgs({
      tenantId: 't-1',
      conversationId: 'conv-1',
      comment,
      parentMessageId: null,
    });
    expect(args.cloneConfidence).toBe('0.812');
    expect(args.groundednessScore).toBe('0.950');
    expect(args.editedAt).toEqual(new Date('2026-02-02T00:00:00.000Z'));
    expect(args.deletedAt).toEqual(new Date('2026-03-03T00:00:00.000Z'));
  });
});
