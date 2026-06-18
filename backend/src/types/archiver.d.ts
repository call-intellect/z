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

  export class Archiver extends Transform {
    append(source: Buffer | string | NodeJS.ReadableStream, data?: EntryData): this;
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
