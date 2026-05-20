// archiver 8 — ESM-rewrite на классы, БЕЗ официальных типов (а @types/archiver
// описывает старый v7 callable-API). Минимальная декларация под то, что использует код.
declare module 'archiver' {
  import { Transform } from 'node:stream';

  export interface ArchiverOptions {
    zlib?: { level?: number };
    [key: string]: unknown;
  }

  export interface EntryData {
    name?: string;
    [key: string]: unknown;
  }

  // Archiver наследует Transform (stream) → есть pipe()/on()/once() и пр.
  export class Archiver extends Transform {
    append(
      source: Buffer | string | NodeJS.ReadableStream,
      data?: EntryData,
    ): this;
    finalize(): Promise<void>;
    abort(): this;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }
  export class TarArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }
  export class JsonArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }
}
