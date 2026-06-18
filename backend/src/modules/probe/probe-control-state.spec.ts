import { describe, expect, it } from 'vitest';

import { ProbeController } from './probe.controller';

describe('ProbeController.deriveState', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('responseStatus=answered → answered', () => {
    expect(
      ProbeController.deriveState({
        status: 'read',
        responseStatus: 'answered',
        expiresAt: null,
        now,
      }),
    ).toBe('answered');
  });

  it('status=responded → answered (даже без responseStatus)', () => {
    expect(
      ProbeController.deriveState({
        status: 'responded',
        responseStatus: null,
        expiresAt: null,
        now,
      }),
    ).toBe('answered');
  });

  it('responseStatus=expired → expired', () => {
    expect(
      ProbeController.deriveState({
        status: 'delivered',
        responseStatus: 'expired',
        expiresAt: null,
        now,
      }),
    ).toBe('expired');
  });

  it('expiresAt в прошлом → expired (приоритет над read_silent)', () => {
    expect(
      ProbeController.deriveState({
        status: 'read',
        responseStatus: 'pending',
        expiresAt: new Date('2026-06-14T00:00:00.000Z'),
        now,
      }),
    ).toBe('expired');
  });

  it('status=read & pending & срок не истёк → read_silent', () => {
    expect(
      ProbeController.deriveState({
        status: 'read',
        responseStatus: 'pending',
        expiresAt: new Date('2026-06-20T00:00:00.000Z'),
        now,
      }),
    ).toBe('read_silent');
  });

  it('status=read & responseStatus=null → read_silent', () => {
    expect(
      ProbeController.deriveState({
        status: 'read',
        responseStatus: null,
        expiresAt: null,
        now,
      }),
    ).toBe('read_silent');
  });

  it('status=delivered & pending → unseen', () => {
    expect(
      ProbeController.deriveState({
        status: 'delivered',
        responseStatus: 'pending',
        expiresAt: null,
        now,
      }),
    ).toBe('unseen');
  });

  it('status=queued → unseen', () => {
    expect(
      ProbeController.deriveState({
        status: 'queued',
        responseStatus: null,
        expiresAt: null,
        now,
      }),
    ).toBe('unseen');
  });
});
