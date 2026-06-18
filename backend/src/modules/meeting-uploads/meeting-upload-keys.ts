export function uploadSourceKey(meetingId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `meetings/${meetingId}/upload/source.${safeExt}`;
}

export function uploadAudioKey(meetingId: string): string {
  return `meetings/${meetingId}/upload/audio.ogg`;
}

export function uploadAudioWavKey(meetingId: string): string {
  return `meetings/${meetingId}/upload/audio.wav`;
}
