import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ParticipantContextService } from './participant-context.service';
import { formatParticipantsForPrompt } from './prompts/participant-context';

function makeService(args: {
  participants: Array<{
    id: string;
    livekitIdentity: string;
    name: string;
    role: 'host' | 'guest';
    isRegisteredUser: boolean;
    userId: string | null;
  }>;
  users?: Array<{ id: string; name: string }>;
}) {
  const findMany = vi.fn(async () => args.participants);
  const userFindMany = vi.fn(async () => args.users ?? []);
  const prisma = {
    participant: { findMany },
    user: { findMany: userFindMany },
  } as unknown as PrismaService;
  return new ParticipantContextService(prisma);
}

describe('ParticipantContextService.loadForMeeting', () => {
  it('пустой meeting → пустой список', async () => {
    const svc = makeService({ participants: [] });
    const result = await svc.loadForMeeting('m-empty');
    expect(result).toEqual([]);
  });

  it('только host → возвращает userId + fullName', async () => {
    const svc = makeService({
      participants: [
        {
          id: 'p-1',
          livekitIdentity: 'host:user_abc',
          name: 'Сергей',
          role: 'host',
          isRegisteredUser: true,
          userId: 'user_abc',
        },
      ],
      users: [{ id: 'user_abc', name: 'Сергей Иванов' }],
    });
    const result = await svc.loadForMeeting('m-1');
    expect(result).toEqual([
      {
        livekitIdentity: 'host:user_abc',
        displayName: 'Сергей',
        userId: 'user_abc',
        fullName: 'Сергей Иванов',
        role: 'host',
      },
    ]);
  });

  it('host + guest → guest без userId', async () => {
    const svc = makeService({
      participants: [
        {
          id: 'p-1',
          livekitIdentity: 'host:user_abc',
          name: 'Анна',
          role: 'host',
          isRegisteredUser: true,
          userId: 'user_abc',
        },
        {
          id: 'p-2',
          livekitIdentity: 'guest:n1',
          name: 'Иван (гость)',
          role: 'guest',
          isRegisteredUser: false,
          userId: null,
        },
      ],
      users: [{ id: 'user_abc', name: 'Анна Иванова' }],
    });
    const result = await svc.loadForMeeting('m-1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      userId: 'user_abc',
      fullName: 'Анна Иванова',
      role: 'host',
    });
    expect(result[1]).toMatchObject({
      userId: null,
      fullName: null,
      role: 'guest',
    });
  });

  it('зарегистрированный гость (isRegisteredUser=true, userId=u1) → userId=u1, fullName из User', async () => {
    const svc = makeService({
      participants: [
        {
          id: 'p-1',
          livekitIdentity: 'invitee:p-1',
          name: 'Настя',
          role: 'guest',
          isRegisteredUser: true,
          userId: 'u1',
        },
      ],
      users: [{ id: 'u1', name: 'Анастасия Иванова' }],
    });
    const result = await svc.loadForMeeting('m-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      livekitIdentity: 'invitee:p-1',
      displayName: 'Настя',
      userId: 'u1',
      fullName: 'Анастасия Иванова',
      role: 'guest',
    });
  });

  it('регресс: анонимный гость (isRegisteredUser=false, userId=null) → userId=null', async () => {
    const svc = makeService({
      participants: [
        {
          id: 'p-2',
          livekitIdentity: 'guest:anon',
          name: 'Иван',
          role: 'guest',
          isRegisteredUser: false,
          userId: null,
        },
      ],
      users: [],
    });
    const result = await svc.loadForMeeting('m-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      displayName: 'Иван',
      userId: null,
      fullName: null,
      role: 'guest',
    });
  });

  it('два host с одинаковым display name — оба возвращаются с разными userId', async () => {
    const svc = makeService({
      participants: [
        {
          id: 'p-1',
          livekitIdentity: 'host:user_one',
          name: 'Сергей',
          role: 'host',
          isRegisteredUser: true,
          userId: 'user_one',
        },
        {
          id: 'p-2',
          livekitIdentity: 'host:user_two',
          name: 'Сергей',
          role: 'host',
          isRegisteredUser: true,
          userId: 'user_two',
        },
      ],
      users: [
        { id: 'user_one', name: 'Сергей Иванов' },
        { id: 'user_two', name: 'Сергей Петров' },
      ],
    });
    const result = await svc.loadForMeeting('m-1');
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.userId).sort()).toEqual(['user_one', 'user_two']);
    expect(result.every((p) => p.displayName === 'Сергей')).toBe(true);
  });
});

describe('formatParticipantsForPrompt', () => {
  it('пустой список → пустая строка', () => {
    expect(formatParticipantsForPrompt([])).toBe('');
  });

  it('host с fullName ≠ displayName → выводит обе формы', () => {
    const out = formatParticipantsForPrompt([
      {
        livekitIdentity: 'host:u1',
        displayName: 'Серёжа',
        userId: 'u1',
        fullName: 'Сергей Иванов',
        role: 'host',
      },
    ]);
    expect(out).toContain('"Серёжа (Сергей Иванов)"');
    expect(out).toContain('userId=u1');
    expect(out).toContain('role=host');
  });

  it('guest → userId=null', () => {
    const out = formatParticipantsForPrompt([
      {
        livekitIdentity: 'guest:n1',
        displayName: 'Иван',
        userId: null,
        fullName: null,
        role: 'guest',
      },
    ]);
    expect(out).toContain('userId=null');
    expect(out).toContain('role=guest');
  });
});
