// Claim quality: drop non-claims, tag claim types, and merge repeats.
import { digitizeNumbers, extractFigures, hasNumber, hasStatistic } from "./numbers.js";

export type ClaimType = "statistic" | "factual" | "prediction" | "promise" | "opinion";
export type DropReason = "greeting" | "procedural" | "question" | "filler";

export const CHECKABLE_TYPES: ReadonlySet<ClaimType> = new Set(["statistic", "factual"]);

const GREETING =
  /^(?:(?:well|and|so),?\s+)?(?:good (?:evening|morning|afternoon|night)|thank you|thanks|welcome|hello|hi)\b|\bladies and gentlemen\b/i;
const PROCEDURAL = [
  /\b\d+[\s-]minutes?\b.*\b(?:response|rebuttal|answer|statement|each)\b/i,
  /\b(?:response|rebuttal)\b.*\b\d+[\s-]minutes?\b/i,
  /\b(?:a|one|1)[\s-]minute(?: response)?,? sir\b/i,
  /\bquestion (?:goes|is) to\b/i,
  /\b(?:first|next|last) (?:topic|question)\b/i,
  /\bwe (?:move|turn|go) (?:now )?to\b/i,
  /\bit will be asked by\b/i,
  /\bwill be asking (?:the )?questions\b/i,
  /\b(?:closing statements?|opening statements?|rebuttals?)\b/i,
  /\b(?:commission on presidential debates|the moderator|format agreed|determined by a drawing|order of those)\b/i,
  /\byour time is up\b|\btime'?s up\b/i,
  /\bwill have up to\b|\bwill have \d+ minutes?\b/i,
  /\byou have (?:\d+|one|two|a) (?:minutes?|seconds?)\b/i,
  /\b(?:\d+|one|two|a) minutes? to (?:respond|answer|reply)\b/i,
  /\bsubject matter of the questions\b/i,
];
const FILLER_START =
  /^(?:well|now|look|okay|ok|yes|no|sure|right|all right|let me|let me say|you know|i'm sorry|that's (?:right|fine|true)|i see|go ahead)\b[,.!]?/i;
const FILLER_ANYWHERE =
  /\b(?:i'll talk about that|let me (?:just )?(?:say|finish|correct)|i have to correct one thing|i want to say this|that's what i want to do|we'll (?:just )?(?:have to )?see|we'll talk about|i'd say|i would say)\b|\((?:laughter|applause|crosstalk)\)/i;

const PROMISE =
  /\b(?:i|we)\s+(?:will|'ll|shall|am going to|'m going to|are going to|'re going to|want to|wanna|intend to|plan to|pledge|promise|would like to|'d like to|would|'d)\b|\b(?:i|we)'(?:ll|d)\b|\bmy (?:plan|program|proposal|budget|administration) (?:will|would)\b/i;
const PREDICTION =
  /\b(?:will|won't|is going to|are going to|going to be|would|wouldn't|next year|in the next \d+ years|by (?:19|20)\d\d)\b/i;
const OPINION =
  /\b(?:i think|i believe|i feel|i don't believe|i don't think|in my (?:view|opinion)|should|shouldn't|must|ought|need to|have to|has to|it's time|i (?:don't|cannot|can't) accept|wrong|best|worst|mind-boggling|insanity|important|enough|courage|hope|deserve)\b/i;
const FACTUAL =
  /\b(?:was|were|had|did|has been|have been|went|came|passed|voted|signed|created|lost|gained|cut|raised|increased|decreased|rose|fell|approved|announced|planned|ranks?|ranked|put|elected|served|spent|owe|owes|is|are|has|have|been|saw|said|told|gave|made|won|built|lowered|doubled)\b|\b\w{3,}ed\b/i;

export interface Classification {
  keep: boolean;
  reason?: DropReason;
  type?: ClaimType;
  checkable: boolean;
}

function wordCount(text: string): number {
  return (text.match(/\b[\p{L}\p{N}']+\b/gu) ?? []).length;
}

/** Decides whether a sentence is a claim, and what kind. */
export function classifyClaim(text: string, context: { moderator?: boolean } = {}): Classification {
  const trimmed = text.trim();
  const words = wordCount(trimmed);
  const numeric = hasNumber(trimmed);
  // "I'd say" and "I would hate" are hedges, not commitments.
  const hedged = /\b(?:i'd say|i would say|i'd hate|i would hate)\b/i.test(trimmed);
  if (GREETING.test(trimmed) && words <= 10) return { keep: false, reason: "greeting", checkable: false };
  const digits = digitizeNumbers(trimmed);
  if (PROCEDURAL.some((pattern) => pattern.test(trimmed) || pattern.test(digits))) {
    return { keep: false, reason: "procedural", checkable: false };
  }
  if (/\?["')\]]?$/.test(trimmed)) return { keep: false, reason: "question", checkable: false };
  // The moderator introduces, frames and hands over; only figures are kept.
  if (context.moderator && !hasStatistic(trimmed)) {
    return { keep: false, reason: "procedural", checkable: false };
  }
  if (words < 5 || (FILLER_START.test(trimmed) && words < 9 && !numeric) || (FILLER_ANYWHERE.test(trimmed) && words < 14)) {
    return { keep: false, reason: "filler", checkable: false };
  }
  let type: ClaimType;
  if (PROMISE.test(trimmed) && !hedged) type = "promise";
  else if (hasStatistic(trimmed)) type = "statistic";
  else if (PREDICTION.test(trimmed)) type = "prediction";
  else if (OPINION.test(trimmed)) type = "opinion";
  else if (FACTUAL.test(trimmed) || /\s[A-Z][a-z]+/.test(trimmed.slice(1))) type = "factual";
  else type = "opinion";
  return { keep: true, type, checkable: CHECKABLE_TYPES.has(type) };
}

const STOP = new Set(
  "a an and are as at be but by for from has have i in is it its of on or so that the their there they this to was we were with you your our my me he she his her him them us not do does did".split(" "),
);

/** Tokens used to recognise the same claim said twice, numbers digitized. */
export function matchTokens(text: string): string[] {
  return [
    ...new Set(
      digitizeNumbers(text)
        .toLowerCase()
        .replace(/\bdollars?\b/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length > 1 && !STOP.has(token))
        .map((token) => (token.length > 4 ? token.replace(/(?:es|s)$/, "") : token)),
    ),
  ];
}

export interface Occurrence {
  claimId: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  text: string;
}

export interface MergedClaim {
  id: string;
  tokens: string[];
  figures: string[];
  occurrences: Occurrence[];
}

/** Similarity of two claims: token overlap, boosted when they share a figure. */
export function claimSimilarity(a: { tokens: string[]; figures: string[] }, b: { tokens: string[]; figures: string[] }): number {
  const setB = new Set(b.tokens);
  const shared = a.tokens.filter((token) => setB.has(token)).length;
  const union = new Set([...a.tokens, ...b.tokens]).size;
  const jaccard = union ? shared / union : 0;
  const sharedFigure = a.figures.some((figure) => b.figures.includes(figure));
  // A shared figure ("$200,000", "4 trillion") is strong evidence, but only
  // when the wording also overlaps; "12 years" alone is not the same claim.
  return sharedFigure && shared >= 3 && jaccard >= 0.3 ? Math.max(jaccard, 0.5 + jaccard / 2) : jaccard;
}

/** Finds an earlier claim that says the same thing, anywhere in the recording. */
export class ClaimIndex {
  readonly merged: MergedClaim[] = [];

  constructor(private readonly threshold = 0.55) {}

  add(occurrence: Occurrence): { merged: MergedClaim; isRepeat: boolean } {
    const tokens = matchTokens(occurrence.text);
    const figures = extractFigures(occurrence.text).filter((figure) => figure !== "1");
    let best: { claim: MergedClaim; score: number } | undefined;
    for (const claim of this.merged) {
      const score = claimSimilarity({ tokens, figures }, claim);
      if (!best || score > best.score) best = { claim, score };
    }
    if (best && best.score >= this.threshold) {
      best.claim.occurrences.push(occurrence);
      return { merged: best.claim, isRepeat: true };
    }
    const claim: MergedClaim = { id: occurrence.claimId, tokens, figures, occurrences: [occurrence] };
    this.merged.push(claim);
    return { merged: claim, isRepeat: false };
  }
}
