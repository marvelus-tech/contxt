// Speaker naming: turn generic diarization labels ("Speaker A", "Speaker 0")
// into names, using self-introductions, how people address each other, and
// who speaks next. Labels without enough evidence keep their generic name.
import type { TranscriptSegment } from "./types.js";

export interface SpeakerName {
  label: string;
  name: string;
  /** 0 to 1. Generic fallbacks carry the confidence of the best guess they rejected. */
  confidence: number;
  named: boolean;
  role?: "moderator";
  evidence: string[];
}

export interface SpeakerNamingResult {
  speakers: SpeakerName[];
  byLabel: Map<string, SpeakerName>;
}

export interface SpeakerNamingOptions {
  /** Optional known participants, for example ["Jim Lehrer", "Ross Perot"]. */
  hints?: string[];
  /** Below this confidence a label keeps its generic name. Default 0.4. */
  minConfidence?: number;
}

interface Candidate {
  key: string;
  display: string;
  aliases: Set<string>;
}

interface Turn {
  label: string;
  text: string;
}

// Titles match in either case: some transcribers write "governor Bill Clinton".
const TITLES = [
  "Governor", "President", "Vice President", "Senator", "Congressman", "Congresswoman",
  "Mr\\.?", "Mrs\\.?", "Ms\\.?", "Mister", "Miss", "Dr\\.?", "Doctor", "Secretary", "Mayor",
]
  .map((title) => `[${title[0]}${title[0]!.toLowerCase()}]${title.slice(1)}`)
  .join("|");
const NAME = "[A-Z][a-z]+(?:[A-Z][a-z]+)?";
const FULL_NAME = `${NAME}(?:\\s(?:[A-Z]\\.\\s?)+)?(?:\\s${NAME})`;

const sentenceSplit = (text: string): string[] =>
  text.split(/(?<=[.?!])\s+/).filter(Boolean);

function keyOf(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  return words.at(-1)!.toLowerCase().replace(/[^a-z]/g, "");
}

function addCandidate(map: Map<string, Candidate>, fullName: string): void {
  const clean = fullName.replace(/\(.*?\)/g, "").trim();
  const key = keyOf(clean);
  if (key.length < 3) return;
  const existing = map.get(key) ?? { key, display: clean, aliases: new Set<string>() };
  if (clean.split(/\s+/).length > existing.display.split(/\s+/).length) existing.display = clean;
  existing.aliases.add(key);
  const first = clean.split(/\s+/)[0]!;
  if (clean.split(/\s+/).length > 1 && first.length > 2) existing.aliases.add(first.toLowerCase());
  map.set(key, existing);
}

/** Collects people mentioned with a title, a full name, or a self-introduction. */
export function discoverCandidates(turns: Turn[], hints: string[] = []): Map<string, Candidate> {
  const map = new Map<string, Candidate>();
  for (const hint of hints) addCandidate(map, hint);
  if (hints.length) return map;
  const all = turns.map((turn) => turn.text).join(" ");
  const patterns = [
    new RegExp(`\\b(?:${TITLES})\\s+(${FULL_NAME}|${NAME})\\b`, "g"),
    new RegExp(`\\b(?:I am|I'm|my name is|asked by|candidate)\\s+(${FULL_NAME})\\b`, "g"),
    new RegExp(`\\b(${FULL_NAME})\\s+of\\s+(?:The\\s|the\\s)?[A-Z]`, "g"),
  ];
  const counts = new Map<string, number>();
  for (const pattern of patterns) {
    for (const match of all.matchAll(pattern)) {
      const name = match[1]!;
      if (/^(The|This|That|And|But|United|American|White)\b/.test(name)) continue;
      addCandidate(map, name);
      counts.set(keyOf(name), (counts.get(keyOf(name)) ?? 0) + 1);
    }
  }
  return map;
}

function mentions(text: string, candidates: Map<string, Candidate>): Array<{ key: string; index: number }> {
  const found: Array<{ key: string; index: number }> = [];
  for (const candidate of candidates.values()) {
    for (const alias of candidate.aliases) {
      const pattern = new RegExp(`\\b${alias}\\b`, "gi");
      for (const match of text.matchAll(pattern)) found.push({ key: candidate.key, index: match.index! });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function toTurns(segments: TranscriptSegment[]): Turn[] {
  const turns: Turn[] = [];
  for (const segment of segments) {
    const label = segment.speaker ?? "unknown";
    const last = turns.at(-1);
    if (last && last.label === label) last.text += ` ${segment.text}`;
    else turns.push({ label, text: segment.text });
  }
  return turns;
}

/**
 * Scores label/name pairs from conversational cues and assigns each name to at
 * most one label.
 */
export function nameSpeakers(
  segments: TranscriptSegment[],
  options: SpeakerNamingOptions = {},
): SpeakerNamingResult {
  const turns = toTurns(segments);
  const candidates = discoverCandidates(turns, options.hints ?? []);
  const labels = [...new Set(turns.map((turn) => turn.label))];
  const votes = new Map<string, Map<string, number>>(labels.map((label) => [label, new Map()]));
  const evidence = new Map<string, string[]>(labels.map((label) => [label, []]));
  const roles = new Map<string, "moderator">();
  const vote = (label: string, key: string, weight: number, why?: string): void => {
    const row = votes.get(label)!;
    row.set(key, (row.get(key) ?? 0) + weight);
    if (why && weight > 0) evidence.get(label)!.push(why);
  };
  const display = (key: string): string => candidates.get(key)?.display ?? key;

  turns.forEach((turn, index) => {
    // 1. Self-introduction: "I am Jim Lehrer".
    for (const match of turn.text.matchAll(/\b(?:I am|I'm|my name is|This is)\s+((?:[A-Z][a-z]+\s?){1,3})/g)) {
      for (const { key } of mentions(match[1]!, candidates)) {
        vote(turn.label, key, 5, `introduced as ${display(key)}`);
      }
    }
    if (/\bI (?:will be|am) (?:the|your) moderator\b/i.test(turn.text)) roles.set(turn.label, "moderator");

    // 2. Third-person mentions inside a long answer point away from the speaker.
    if (turn.text.split(/\s+/).length > 40) {
      const body = sentenceSplit(turn.text).slice(0, -1).join(" ");
      const introduced = /\b(?:I am|I'm|my name is)\b/.test(body);
      if (!introduced) {
        for (const { key } of mentions(body, candidates)) vote(turn.label, key, -0.5);
      }
    }

    const next = turns[index + 1];
    if (next && next.label !== turn.label) {
      // 3. Forward address: the last name said before the floor changes hands
      //    is usually whoever speaks next ("Mr. Perot, what do you believe...").
      const sentences = sentenceSplit(turn.text);
      for (let back = 0; back < Math.min(3, sentences.length); back += 1) {
        const sentence = sentences[sentences.length - 1 - back]!;
        const found = mentions(sentence, candidates);
        if (found.length === 0) continue;
        const askedBy = sentence.match(/asked by\s+(.+)$/i);
        const target = askedBy ? mentions(askedBy[1]!, candidates)[0] ?? found.at(-1)! : found.at(-1)!;
        const weight = (askedBy ? 3 : 2) / (1 + back);
        vote(next.label, target.key, weight, `addressed as ${display(target.key)} by the previous speaker`);
        break;
      }
      // 4. Reply address: "Good evening, Jim." names the previous speaker.
      const opener = sentenceSplit(next.text)[0] ?? "";
      const vocative = opener.match(/,\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)[.!]?$/);
      if (vocative) {
        for (const { key } of mentions(vocative[1]!, candidates)) {
          vote(turn.label, key, 1, `addressed as ${display(key)} in a reply`);
        }
      }
    }
  });

  // Greedy one-to-one assignment by score.
  const pairs = labels.flatMap((label) =>
    [...votes.get(label)!.entries()].filter(([, score]) => score > 0).map(([key, score]) => ({ label, key, score })),
  );
  pairs.sort((a, b) => b.score - a.score);
  const assigned = new Map<string, { key: string; score: number }>();
  const usedKeys = new Set<string>();
  for (const pair of pairs) {
    if (assigned.has(pair.label) || usedKeys.has(pair.key)) continue;
    assigned.set(pair.label, pair);
    usedKeys.add(pair.key);
  }

  const minConfidence = options.minConfidence ?? 0.4;
  const speakers = labels.map((label): SpeakerName => {
    const positive = [...votes.get(label)!.values()].filter((score) => score > 0);
    const total = positive.reduce((sum, score) => sum + score, 0);
    const pick = assigned.get(label);
    const share = pick && total ? pick.score / total : 0;
    // Strength saturates around three strong cues.
    const strength = pick ? Math.min(1, pick.score / 4) : 0;
    const confidence = Number((share * (0.5 + 0.5 * strength)).toFixed(2));
    const role = roles.get(label);
    const unique = [...new Set(evidence.get(label))].slice(0, 4);
    if (pick && confidence >= minConfidence) {
      return { label, name: display(pick.key), confidence, named: true, ...(role ? { role } : {}), evidence: unique };
    }
    return { label, name: label, confidence, named: false, ...(role ? { role } : {}), evidence: unique };
  });
  return { speakers, byLabel: new Map(speakers.map((speaker) => [speaker.label, speaker])) };
}

/** True for diarization labels such as "Speaker A", "Speaker 0", "S1" or "A". */
export function isGenericLabel(label: string | undefined): boolean {
  return !label || /^(speaker\s*\w+|s\d+|[A-Z]|\d+)$/i.test(label.trim());
}

/** Applies a naming result, keeping the generic label when a name is not trusted. */
export function applySpeakerNames(
  segments: TranscriptSegment[],
  result: SpeakerNamingResult,
): TranscriptSegment[] {
  return segments.map((segment) => {
    const named = segment.speaker ? result.byLabel.get(segment.speaker) : undefined;
    if (!named) return segment;
    return {
      ...segment,
      speaker: named.name,
      speakerConfidence: named.confidence,
      ...(named.role ? { speakerRole: named.role } : {}),
    };
  });
}
