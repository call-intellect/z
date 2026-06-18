import { Injectable, Logger } from '@nestjs/common';

export type CitationType = 'ib' | 'theme' | 'ent' | 'mtg' | 'goal' | 'dec';

export interface CitationDto {
  number: number;
  type: CitationType;
  id: string;
  label: string;
  url: string | null;
}

export interface CitationSource {
  type: CitationType;
  id: string;
  label: string;
}

export interface ParsedNarrative {
  text: string;
  citations: CitationDto[];
}

@Injectable()
export class NarrativeCitationsParserService {
  private readonly logger = new Logger(NarrativeCitationsParserService.name);

  private static readonly MARKER_RE = /\[(ib|theme|ent|mtg|goal|dec):([A-Za-z0-9_-]{6,64})\]/g;

  parse(rawText: string, sources: CitationSource[]): ParsedNarrative {
    const validById = new Map<string, CitationSource>();
    for (const s of sources) {
      validById.set(`${s.type}:${s.id}`, s);
    }

    const found: Array<{ start: number; end: number; type: CitationType; id: string }> = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(NarrativeCitationsParserService.MARKER_RE.source, 'g');
    while ((match = re.exec(rawText)) !== null) {
      const type = match[1] as CitationType;
      const id = match[2]!;
      found.push({ start: match.index, end: match.index + match[0].length, type, id });
    }

    const keyToNumber = new Map<string, number>();
    const citations: CitationDto[] = [];
    for (const f of found) {
      const key = `${f.type}:${f.id}`;
      if (!validById.has(key)) continue;
      if (!keyToNumber.has(key)) {
        const number = keyToNumber.size + 1;
        keyToNumber.set(key, number);
        const src = validById.get(key)!;
        citations.push({
          number,
          type: f.type,
          id: f.id,
          label: src.label,
          url: this.buildUrl(f.type, f.id),
        });
      }
    }

    let text = rawText;
    const sorted = [...found].sort((a, b) => b.start - a.start);
    for (const f of sorted) {
      const key = `${f.type}:${f.id}`;
      if (validById.has(key)) {
        const number = keyToNumber.get(key)!;
        text = text.slice(0, f.start) + `[${number}]` + text.slice(f.end);
      } else {
        text = text.slice(0, f.start) + text.slice(f.end);
      }
    }

    text = text
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return { text, citations };
  }

  private buildUrl(type: CitationType, id: string): string | null {
    switch (type) {
      case 'theme':
        return `/themes/${encodeURIComponent(id)}`;
      case 'goal':
        return `/goals/${encodeURIComponent(id)}`;
      case 'dec':
        return `/decisions/${encodeURIComponent(id)}`;
      case 'mtg':
        return `/meetings/${encodeURIComponent(id)}/result`;
      case 'ib':
      case 'ent':
        return null;
      default:
        return null;
    }
  }
}
