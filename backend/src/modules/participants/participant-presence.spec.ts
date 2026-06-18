import { describe, expect, it } from 'vitest';

import { isPresentParticipant } from './participant-presence';

describe('isPresentParticipant', () => {
  it('исключает приглашённого, который не пришёл (invited)', () => {
    expect(isPresentParticipant({ invitationStatus: 'invited' })).toBe(false);
  });

  it('считает пришедшего приглашённого (joined)', () => {
    expect(isPresentParticipant({ invitationStatus: 'joined' })).toBe(true);
  });

  it('считает хоста/гостя (none)', () => {
    expect(isPresentParticipant({ invitationStatus: 'none' })).toBe(true);
  });

  it('считает строку без статуса (null)', () => {
    expect(isPresentParticipant({ invitationStatus: null })).toBe(true);
  });

  it('считает строку без статуса (undefined)', () => {
    expect(isPresentParticipant({ invitationStatus: undefined })).toBe(true);
  });

  it('сценарий бага: «позвал двоих → показало 5» схлопывается до 3', () => {
    const participants = [
      { invitationStatus: 'none' },
      { invitationStatus: 'invited' },
      { invitationStatus: 'invited' },
      { invitationStatus: 'none' },
      { invitationStatus: 'none' },
    ];

    expect(participants.length).toBe(5);
    expect(participants.filter(isPresentParticipant).length).toBe(3);
  });
});
