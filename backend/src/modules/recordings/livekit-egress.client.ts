import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DirectFileOutput,
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';

export interface EgressS3Output {
  bucket: string;
  key: string;
}

export interface CompositeEgressState {
  egressId: string;
  status: 'complete' | 'failed' | 'active';
  url: string | null;
  bytes: number | null;
  durationSeconds: number | null;
}

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

  async listCompositeEgress(meetingId: string): Promise<CompositeEgressState | null> {
    const list = await this.egress.listEgress({ roomName: meetingId });
    const e = list.find((x) => x.request?.case === 'roomComposite') ?? list[0];
    if (!e) return null;
    const file = e.fileResults?.[0] ?? null;
    const isComplete = e.status === EgressStatus.EGRESS_COMPLETE;
    const isFailed = e.status === EgressStatus.EGRESS_FAILED;
    return {
      egressId: e.egressId,
      status: isComplete ? 'complete' : isFailed ? 'failed' : 'active',
      url: file?.location ?? null,
      bytes: file?.size != null ? Number(file.size) : null,
      durationSeconds:
        file?.duration != null ? Math.round(Number(file.duration) / 1_000_000_000) : null,
    };
  }

  private buildS3Upload(bucket: string): S3Upload {
    return new S3Upload({
      accessKey: this.cfg.s3.accessKey,
      secret: this.cfg.s3.secretKey,
      region: this.cfg.s3.region,
      endpoint: this.cfg.s3.endpointUrl,
      bucket,
      forcePathStyle: true,
    });
  }
}
