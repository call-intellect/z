import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import { TypedConfigService } from '../../common/config/index';

@Injectable()
export class PasswordService {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.cfg.argon.memoryKb,
      timeCost: this.cfg.argon.iterations,
      parallelism: this.cfg.argon.parallelism,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
