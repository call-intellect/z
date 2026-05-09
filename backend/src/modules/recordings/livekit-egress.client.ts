import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DirectFileOutput,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';

/**
 * Параметры S3-хранилища, общие для всех egress'ов.
 * Создаются один раз из `cfg.s3.*`.
 */
export interface EgressS3Output {
  /** Имя bucket'а — куда складывать файлы. */
  bucket: string;
  /** Путь до файла внутри bucket'а (S3 key). */
  key: string;
}

/**
 * Тонкая обёртка над `EgressClient` (livekit-server-sdk).
 *
 * Отвечает только за:
 *   1) Сборку `S3Upload` из `cfg.s3.*` (forcePathStyle = true для совместимости
 *      с MinIO/Selectel/SberCloud, у которых virtual-hosted style — не дефолт).
 *   2) Запуск composite/track egress'а с заранее посчитанным ключом.
 *   3) Stop egress'а по `egressId`.
 *
 * Бизнес-логика (статусы Recording, retention, AudioTrack) — в `RecordingsService`.
 */
@Injectable()
export class LivekitEgressClient {
  private readonly logger = new Logger(LivekitEgressClient.name);
  private readonly egress: EgressClient;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.egress = new EgressClient(
      this.cfg.livekit.apiUrl,
      this.cfg.livekit.apiKey,
      this.cfg.livekit.apiSecret,
    );
  }

  /**
   * Composite egress: один MP4 со всем room'ом (миксованное видео + аудио).
   * Используется как «основная» запись (mainVideoUrl).
   */
  async startRoomCompositeEgress(
    meeting: { id: string },
    s3Output: EgressS3Output,
  ): Promise<{ egressId: string }> {
    const file = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3Output.key,
      output: {
        case: 's3',
        value: this.buildS3Upload(s3Output.bucket),
      },
    });

    const info = await this.egress.startRoomCompositeEgress(meeting.id, { file });
    this.logger.log(
      { meetingId: meeting.id, egressId: info.egressId, key: s3Output.key },
      'Composite egress запущен',
    );
    return { egressId: info.egressId };
  }

  /**
   * Track egress: один аудиотрек одного участника в OGG.
   * Используется для разделения по спикерам в AI-pipeline.
   *
   * Важно: трек должен быть AUDIO. Проверка типа — на стороне вызывающего.
   */
  async startTrackEgress(
    meeting: { id: string },
    trackId: string,
    s3Output: EgressS3Output,
  ): Promise<{ egressId: string }> {
    const file = new DirectFileOutput({
      filepath: s3Output.key,
      output: {
        case: 's3',
        value: this.buildS3Upload(s3Output.bucket),
      },
    });

    const info = await this.egress.startTrackEgress(meeting.id, file, trackId);
    this.logger.log(
      {
        meetingId: meeting.id,
        trackId,
        egressId: info.egressId,
        key: s3Output.key,
      },
      'Track egress запущен',
    );
    return { egressId: info.egressId };
  }

  async stopEgress(egressId: string): Promise<void> {
    try {
      await this.egress.stopEgress(egressId);
      this.logger.log({ egressId }, 'Egress остановлен');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Если egress уже завершён — это норма для idle-завершений.
      if (
        message.toLowerCase().includes('not found') ||
        message.toLowerCase().includes('already')
      ) {
        this.logger.debug({ egressId, message }, 'stopEgress: уже завершён');
        return;
      }
      this.logger.warn({ egressId, message }, 'stopEgress упал');
      throw err;
    }
  }

  // ────────────────────────── helpers ────────────────────────────────────

  private buildS3Upload(bucket: string): S3Upload {
    return new S3Upload({
      accessKey: this.cfg.s3.accessKey,
      secret: this.cfg.s3.secretKey,
      region: this.cfg.s3.region,
      endpoint: this.cfg.s3.endpointUrl,
      bucket,
      // Path-style критичен для MinIO и большинства российских S3-провайдеров.
      forcePathStyle: true,
    });
  }
}
