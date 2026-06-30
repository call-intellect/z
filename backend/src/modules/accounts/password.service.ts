import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import bcrypt from 'bcrypt';

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
      if (hash.startsWith('$argon2')) {
        return await argon2.verify(hash, plain);
      }
      if (hash.startsWith('$2')) {
        return await bcrypt.compare(plain, hash);
      }
      return false;
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    if (!hash.startsWith('$argon2id$')) return true;
    try {
      return argon2.needsRehash(hash, {
        memoryCost: this.cfg.argon.memoryKb,
        timeCost: this.cfg.argon.iterations,
        parallelism: this.cfg.argon.parallelism,
      });
    } catch {
      return true;
    }
  }
}
