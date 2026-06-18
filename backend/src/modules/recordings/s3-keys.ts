export function compositeKey(meetingId: string): string {
  return `meetings/${meetingId}/composite.mp4`;
}

export function audioTrackKey(meetingId: string, participantIdentity: string): string {
  return `meetings/${meetingId}/audio/${participantIdentity}.ogg`;
}

export function transcriptMergedKey(meetingId: string): string {
  return `meetings/${meetingId}/transcripts/merged.json`;
}

export function extractKeyFromUrl(url: string, bucket: string): string {
  if (!url) return '';

  if (!url.includes('://')) {
    return url.replace(/^\/+/, '');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }

  const pathname = parsed.pathname.replace(/^\/+/, '');
  if (pathname.startsWith(`${bucket}/`)) {
    return pathname.slice(bucket.length + 1);
  }
  if (parsed.host.startsWith(`${bucket}.`)) {
    return pathname;
  }
  if (parsed.protocol === 's3:' && parsed.host === bucket) {
    return pathname;
  }
  return pathname;
}
