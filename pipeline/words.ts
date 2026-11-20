import type { TranscriptSegment } from "./types.js";

/** One recognised word with its timing and the provider's speaker label. */
export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
}

export interface DeepgramTranscript {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        words?: Array<{
          word: string;
          punctuated_word?: string;
          start: number;
          end: number;
          speaker?: number;
        }>;
      }>;
    }>;
  };
}

const SENTENCE_END = /[.?!]["'”’)\]]?$/;
// Titles and abbreviations that end in a period but do not end a sentence.
const ABBREVIATION = /^(?:Mr|Mrs|Ms|Dr|St|Sr|Jr|Gov|Sen|Rep|Gen|Lt|Col|Prof|Mt|vs|etc|U\.S|D\.C)\.$/i;

/**
 * Groups words into sentence-sized segments. A new segment starts whenever the
 * speaker changes, so every segment has exactly one speaker.
 */
export function wordsToSegments(
  words: TimedWord[],
  minWords = 4,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TimedWord[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0]!;
    segments.push({
      startMs: first.startMs,
      endMs: current.at(-1)!.endMs,
      text: current.map((word) => word.text).join(" "),
      ...(first.speaker ? { speaker: first.speaker } : {}),
    });
    current = [];
  };
  for (const word of words) {
    if (current.length > 0 && current.at(-1)!.speaker !== word.speaker) flush();
    current.push(word);
    if (SENTENCE_END.test(word.text) && !ABBREVIATION.test(word.text) && current.length >= minWords) {
      flush();
    }
  }
  flush();
  return segments;
}

export function deepgramToSegments(response: DeepgramTranscript): TranscriptSegment[] {
  const words = response.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return wordsToSegments(
    words.map((word) => ({
      text: word.punctuated_word ?? word.word,
      startMs: Math.round(word.start * 1000),
      endMs: Math.round(word.end * 1000),
      ...(word.speaker !== undefined ? { speaker: `Speaker ${word.speaker}` } : {}),
    })),
  );
}
