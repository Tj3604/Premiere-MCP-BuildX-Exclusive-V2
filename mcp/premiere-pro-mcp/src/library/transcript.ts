/**
 * Plain spoken text out of any transcript format BuildX delivers.
 *
 * Seen in `to be posted`:
 *   - WhisperX words.json      [{text|word,start,end}] or {words:[…]}
 *   - Whisper / sidecar JSON   {text, segments?} (studio reels, PM updates)
 *   - SRT                      index / timecode / text blocks
 *   - Premiere text export     "00:00:02:00 - 00:00:22:04" then an optional
 *                              speaker line ("Host", "GUEST", "Unknown"), then text
 *   - Timecoded text           "[00:00:12] line" or "[00:00:00 - 00:00:01]  line"
 *   - Plain text               one paragraph
 *
 * Text only: timings are not trusted across these formats.
 */

import { readFile } from 'node:fs/promises';

// A full timecode range line, with ':' ';' or ',' separators (Premiere, DaVinci, SRT).
const RANGE_LINE = /^\s*\d{1,2}[:;]\d{2}[:;]\d{2}(?:[:;,.]\d{1,3})?\s*(?:-->|-)\s*\d{1,2}[:;]\d{2}[:;]\d{2}(?:[:;,.]\d{1,3})?\s*$/;
const INDEX_LINE = /^\s*\d+\s*$/;
const LEADING_BRACKET_TC = /^\s*\[[\d:;.,\s-]+\]\s*/;
// A one-word line straight after a range line is a speaker label, not dialogue.
const SPEAKER_LINE = /^\s*[A-Za-z][A-Za-z .'-]{0,30}\s*$/;
const HEADER_RULE = /^\s*(=+|-{3,})\s*$/;

function wordsToText(words: unknown[]): string {
  return words
    .map((w) => {
      if (typeof w !== 'object' || w === null) return '';
      const o = w as Record<string, unknown>;
      return String(o.text ?? o.word ?? '').trim();
    })
    .filter(Boolean)
    .join(' ');
}

export function textFromJson(raw: string): string {
  const data: unknown = JSON.parse(raw);
  if (Array.isArray(data)) return wordsToText(data);
  if (typeof data === 'object' && data !== null) {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.words)) return wordsToText(o.words);
    if (typeof o.text === 'string') return o.text.trim();
    if (Array.isArray(o.segments)) {
      return o.segments
        .map((s) => (typeof s === 'object' && s !== null ? String((s as Record<string, unknown>).text ?? '').trim() : ''))
        .filter(Boolean)
        .join(' ');
    }
  }
  throw new Error('Unrecognised transcript JSON');
}

export function textFromLines(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  let afterRange = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || INDEX_LINE.test(trimmed) || HEADER_RULE.test(trimmed)) continue;
    if (RANGE_LINE.test(trimmed)) {
      afterRange = true;
      continue;
    }
    if (afterRange && SPEAKER_LINE.test(trimmed) && !/[.!?,]/.test(trimmed) && trimmed.split(/\s+/).length <= 3) {
      afterRange = false;
      continue;
    }
    afterRange = false;
    const text = trimmed.replace(LEADING_BRACKET_TC, '').trim();
    if (text) kept.push(text);
  }
  // Generated timecoded files open with "<title>" / "Timecoded transcript" / "====".
  if (kept[1] === 'Timecoded transcript') kept.splice(0, 2);
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

export function transcriptText(raw: string, filePath: string): string {
  return filePath.toLowerCase().endsWith('.json') ? textFromJson(raw) : textFromLines(raw);
}

export async function readTranscriptText(filePath: string): Promise<string> {
  return transcriptText(await readFile(filePath, 'utf8'), filePath);
}

/** First sentence, the way transcribe-x.mjs splits its .md (terminal punctuation). */
export function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(?:["”']?)(?:\s|$)/.exec(text.trim());
  return (match ? match[1]! : text.trim()).trim();
}
