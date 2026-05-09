import { describe, expect, it } from 'vitest';

import { audioTrackKey, compositeKey, extractKeyFromUrl } from './s3-keys';

describe('s3-keys', () => {
  describe('compositeKey', () => {
    it('формирует ключ по конвенции meetings/<id>/composite.mp4', () => {
      expect(compositeKey('m-123')).toBe('meetings/m-123/composite.mp4');
    });
  });

  describe('audioTrackKey', () => {
    it('кладёт OGG-треки в meetings/<id>/audio/<identity>.ogg', () => {
      expect(audioTrackKey('m-123', 'host:u-1')).toBe('meetings/m-123/audio/host:u-1.ogg');
      expect(audioTrackKey('m-123', 'guest:abcd')).toBe(
        'meetings/m-123/audio/guest:abcd.ogg',
      );
    });
  });

  describe('extractKeyFromUrl', () => {
    const bucket = 'z-records';

    it('path-style: https://endpoint/bucket/key', () => {
      const url = 'https://s3.z.local/z-records/meetings/m1/composite.mp4';
      expect(extractKeyFromUrl(url, bucket)).toBe('meetings/m1/composite.mp4');
    });

    it('virtual-hosted: https://bucket.endpoint/key', () => {
      const url = 'https://z-records.s3.z.local/meetings/m1/composite.mp4';
      expect(extractKeyFromUrl(url, bucket)).toBe('meetings/m1/composite.mp4');
    });

    it('s3:// схема', () => {
      const url = 's3://z-records/meetings/m1/audio/host:u-1.ogg';
      expect(extractKeyFromUrl(url, bucket)).toBe('meetings/m1/audio/host:u-1.ogg');
    });

    it('голый ключ — возвращается как есть', () => {
      expect(extractKeyFromUrl('meetings/m1/composite.mp4', bucket)).toBe(
        'meetings/m1/composite.mp4',
      );
    });

    it('голый ключ с ведущим слешем — слеш отрезается', () => {
      expect(extractKeyFromUrl('/meetings/m1/composite.mp4', bucket)).toBe(
        'meetings/m1/composite.mp4',
      );
    });

    it('пустая строка → пустая строка', () => {
      expect(extractKeyFromUrl('', bucket)).toBe('');
    });
  });
});
