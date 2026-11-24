// pipeline/numbers.ts
var UNITS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19
};
var TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};
var SCALES = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12
};
var ORDINALS = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  fiftieth: 50,
  hundredth: 100
};
function isNumberWord(word) {
  return word in UNITS || word in TENS || word in SCALES || word === "hundred";
}
function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
}
function parseWords(words) {
  let total = 0;
  let current = 0;
  let seen = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word in UNITS) current += UNITS[word];
    else if (word in TENS) current += TENS[word];
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word in SCALES) {
      total += (current || 1) * SCALES[word];
      current = 0;
    } else if (word === "and" || word === "a") continue;
    else if (word === "half") current += 0.5;
    else return void 0;
    seen = true;
  }
  return seen ? total + current : void 0;
}
function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}
function digitizeNumbers(text) {
  let out = text.replace(
    /\$?(\d+(?:\.\d+)?)\s+(thousand|million|billion|trillion)\b/gi,
    (match, value, scale) => `${match.startsWith("$") ? "$" : ""}${formatNumber(Number(value) * SCALES[scale.toLowerCase()])}`
  ).replace(/\$(\d[\d,]*(?:\.\d+)?)/g, (_m, value) => `${value.replace(/,/g, "")} dollars`).replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) => m.replace(/,/g, "")).replace(/(\d)\s*%/g, "$1 percent");
  out = out.replace(
    /\b(?:(nineteen|twenty)[\s-]+)?(twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b/gi,
    (_match, century, decade) => {
      const tens = TENS[decade.toLowerCase().replace(/ies$/, "y")];
      const prefix = century ? century.toLowerCase() === "nineteen" ? "19" : "20" : "";
      return `${prefix}${tens}s`;
    }
  );
  out = out.replace(
    /\b(nineteen|twenty)[\s-]+(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?\b/gi,
    (match, century, tens, unit) => {
      const lower = tens.toLowerCase();
      const prefix = century.toLowerCase() === "nineteen" ? 1900 : 2e3;
      const rest = (UNITS[lower] ?? TENS[lower] ?? 0) + (unit ? UNITS[unit.toLowerCase()] : 0);
      if (prefix === 2e3 && !(lower in TENS)) return match;
      return String(prefix + rest);
    }
  );
  const tokens = out.split(/(\s+|(?<=\w)-(?=\w))/);
  const result = [];
  let run = [];
  let runRaw = [];
  const flush = () => {
    if (run.length === 0) return;
    const tail = [];
    while (run.length && ["and", "a", "half"].includes(run.at(-1)) && !(run.at(-1) === "half" && run.at(-2) === "a")) {
      run.pop();
      tail.unshift(runRaw.pop());
    }
    const value = run.length ? parseWords(run) : void 0;
    if (value !== void 0 && (run[0] === "hundred" || run[0] in SCALES)) {
      const last = result.length - 1;
      const article = result[last - 1];
      if (/^\s+$/.test(result[last] ?? "") && article?.toLowerCase() === "a") {
        result.splice(last - 1, 2);
      }
    }
    if (value !== void 0) result.push(formatNumber(value));
    else result.push(runRaw.join(" "));
    if (tail.length) result.push(` ${tail.join(" ")}`);
    run = [];
    runRaw = [];
  };
  for (const token of tokens) {
    if (/^\s+$/.test(token) || token === "-") {
      if (run.length) continue;
      result.push(token);
      continue;
    }
    const match = token.match(/^([A-Za-z]+)([^A-Za-z]*)$/);
    const word = match?.[1]?.toLowerCase();
    if (word && (isNumberWord(word) || run.length > 0 && ["and", "a", "half"].includes(word))) {
      run.push(word);
      runRaw.push(match[1]);
      if (match[2]) {
        flush();
        result.push(match[2]);
      }
      continue;
    }
    if (run.length) {
      flush();
      result.push(" ");
    }
    const ordinal = word ? ORDINALS[word] : void 0;
    if (ordinal !== void 0 && word !== "second") {
      result.push(`${ordinal}${ordinalSuffix(ordinal)}${match[2] ?? ""}`);
    } else result.push(token);
  }
  flush();
  return result.join("").replace(/[ \t]{2,}/g, " ").replace(/ ([,.;:!?])/g, "$1").trim();
}
function extractFigures(text) {
  return [...digitizeNumbers(text).matchAll(/\b\d+(?:\.\d+)?(?:st|nd|rd|th|s)?\b/g)].map((m) => m[0]);
}
function hasNumber(text) {
  const cleaned = text.replace(/\b(one|first)\b(?![\s-]+(hundred|thousand|million|billion|trillion|percent))/gi, "").replace(/\b(1st|one)\b/gi, "");
  return extractFigures(cleaned).some((figure) => figure !== "1") || /\b(?:twice|double|triple|tripled|doubled|halved|percent)\b/i.test(text);
}
function hasStatistic(text) {
  const digits = digitizeNumbers(text);
  if (/\b(?:twice|double|triple|tripled|doubled|halved|percent)\b/i.test(text)) return true;
  for (const match of digits.matchAll(/\b(\d+(?:\.\d+)?)(st|nd|rd|th|s)?\b(\s+\w+)?/g)) {
    const value = Number(match[1]);
    const suffix = match[2];
    const unit = (match[3] ?? "").trim().toLowerCase();
    if (suffix && value !== 1) return true;
    if (value >= 10) return true;
    if (/^(?:percent|dollars?|years?|months?|weeks?|days?|million|billion|trillion|times|points?|jobs|people|states)$/.test(unit) && value !== 1) {
      return true;
    }
  }
  return false;
}

// pipeline/claims.ts
var CHECKABLE_TYPES = /* @__PURE__ */ new Set(["statistic", "factual"]);
var GREETING = /^(?:(?:well|and|so),?\s+)?(?:good (?:evening|morning|afternoon|night)|thank you|thanks|welcome|hello|hi)\b|\bladies and gentlemen\b/i;
var PROCEDURAL = [
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
  /\bsubject matter of the questions\b/i
];
var FILLER_START = /^(?:well|now|look|okay|ok|yes|no|sure|right|all right|let me|let me say|you know|i'm sorry|that's (?:right|fine|true)|i see|go ahead)\b[,.!]?/i;
var FILLER_ANYWHERE = /\b(?:i'll talk about that|let me (?:just )?(?:say|finish|correct)|i have to correct one thing|i want to say this|that's what i want to do|we'll (?:just )?(?:have to )?see|we'll talk about|i'd say|i would say)\b|\((?:laughter|applause|crosstalk)\)/i;
var PROMISE = /\b(?:i|we)\s+(?:will|'ll|shall|am going to|'m going to|are going to|'re going to|want to|wanna|intend to|plan to|pledge|promise|would like to|'d like to|would|'d)\b|\b(?:i|we)'(?:ll|d)\b|\bmy (?:plan|program|proposal|budget|administration) (?:will|would)\b/i;
var PREDICTION = /\b(?:will|won't|is going to|are going to|going to be|would|wouldn't|next year|in the next \d+ years|by (?:19|20)\d\d)\b/i;
var OPINION = /\b(?:i think|i believe|i feel|i don't believe|i don't think|in my (?:view|opinion)|should|shouldn't|must|ought|need to|have to|has to|it's time|i (?:don't|cannot|can't) accept|wrong|best|worst|mind-boggling|insanity|important|enough|courage|hope|deserve)\b/i;
var FACTUAL = /\b(?:was|were|had|did|has been|have been|went|came|passed|voted|signed|created|lost|gained|cut|raised|increased|decreased|rose|fell|approved|announced|planned|ranks?|ranked|put|elected|served|spent|owe|owes|is|are|has|have|been|saw|said|told|gave|made|won|built|lowered|doubled)\b|\b\w{3,}ed\b/i;
function wordCount(text) {
  return (text.match(/\b[\p{L}\p{N}']+\b/gu) ?? []).length;
}
function classifyClaim(text, context = {}) {
  const trimmed = text.trim();
  const words = wordCount(trimmed);
  const numeric = hasNumber(trimmed);
  const hedged = /\b(?:i'd say|i would say|i'd hate|i would hate)\b/i.test(trimmed);
  if (GREETING.test(trimmed) && words <= 10) return { keep: false, reason: "greeting", checkable: false };
  const digits = digitizeNumbers(trimmed);
  if (PROCEDURAL.some((pattern) => pattern.test(trimmed) || pattern.test(digits))) {
    return { keep: false, reason: "procedural", checkable: false };
  }
  if (/\?["')\]]?$/.test(trimmed)) return { keep: false, reason: "question", checkable: false };
  if (context.moderator && !hasStatistic(trimmed)) {
    return { keep: false, reason: "procedural", checkable: false };
  }
  if (words < 5 || FILLER_START.test(trimmed) && words < 9 && !numeric || FILLER_ANYWHERE.test(trimmed) && words < 14) {
    return { keep: false, reason: "filler", checkable: false };
  }
  let type;
  if (PROMISE.test(trimmed) && !hedged) type = "promise";
  else if (hasStatistic(trimmed)) type = "statistic";
  else if (PREDICTION.test(trimmed)) type = "prediction";
  else if (OPINION.test(trimmed)) type = "opinion";
  else if (FACTUAL.test(trimmed) || /\s[A-Z][a-z]+/.test(trimmed.slice(1))) type = "factual";
  else type = "opinion";
  return { keep: true, type, checkable: CHECKABLE_TYPES.has(type) };
}
var STOP = new Set(
  "a an and are as at be but by for from has have i in is it its of on or so that the their there they this to was we were with you your our my me he she his her him them us not do does did".split(" ")
);
function matchTokens(text) {
  return [
    ...new Set(
      digitizeNumbers(text).toLowerCase().replace(/\bdollars?\b/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((token) => token.length > 1 && !STOP.has(token)).map((token) => token.length > 4 ? token.replace(/(?:es|s)$/, "") : token)
    )
  ];
}
function claimSimilarity(a, b) {
  const setB = new Set(b.tokens);
  const shared = a.tokens.filter((token) => setB.has(token)).length;
  const union = (/* @__PURE__ */ new Set([...a.tokens, ...b.tokens])).size;
  const jaccard = union ? shared / union : 0;
  const sharedFigure = a.figures.some((figure) => b.figures.includes(figure));
  return sharedFigure && shared >= 3 && jaccard >= 0.3 ? Math.max(jaccard, 0.5 + jaccard / 2) : jaccard;
}
var ClaimIndex = class {
  constructor(threshold = 0.55) {
    this.threshold = threshold;
  }
  threshold;
  merged = [];
  add(occurrence) {
    const tokens = matchTokens(occurrence.text);
    const figures = extractFigures(occurrence.text).filter((figure) => figure !== "1");
    let best;
    for (const claim2 of this.merged) {
      const score = claimSimilarity({ tokens, figures }, claim2);
      if (!best || score > best.score) best = { claim: claim2, score };
    }
    if (best && best.score >= this.threshold) {
      best.claim.occurrences.push(occurrence);
      return { merged: best.claim, isRepeat: true };
    }
    const claim = { id: occurrence.claimId, tokens, figures, occurrences: [occurrence] };
    this.merged.push(claim);
    return { merged: claim, isRepeat: false };
  }
};

// pipeline/stages.ts
var stopWords = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "was",
  "were"
]);
function normalizeClaim(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function contentTokens(text) {
  return normalizeClaim(text).split(" ").filter((token) => token.length > 2 && !stopWords.has(token));
}
var TRAILING_ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Sr|Jr|Gov|Sen|Rep|Gen|Lt|Col|Prof|Mt|vs)\.$/i;
function joinAbbreviations(parts) {
  const out = [];
  for (const part of parts.filter(Boolean)) {
    const last = out.at(-1);
    if (last !== void 0 && TRAILING_ABBREVIATION.test(last)) out[out.length - 1] = `${last} ${part}`;
    else out.push(part);
  }
  return out;
}
var HeuristicClaimExtractor = class {
  carry = "";
  carrySegment;
  nextId = 1;
  sentenceSegmenter = new Intl.Segmenter("en", {
    granularity: "sentence"
  });
  async extract(segments, _context) {
    const claims = [];
    for (const segment of segments) {
      if (this.carry && this.carrySegment && this.carrySegment.speaker !== segment.speaker) {
        const claim = this.toClaim(this.carry, this.carrySegment);
        if (claim) claims.push(claim);
        this.carry = "";
        this.carrySegment = void 0;
      }
      const startSegment = this.carry && this.carrySegment ? this.carrySegment : segment;
      const combined = `${this.carry} ${segment.text}`.trim();
      const sentences = joinAbbreviations(
        [...this.sentenceSegmenter.segment(combined)].map(({ segment: sentence }) => sentence.trim())
      );
      const complete = sentences.filter((sentence) => /[.!?]["')\]]?$/.test(sentence));
      this.carry = sentences.filter((sentence) => !/[.!?]["')\]]?$/.test(sentence)).at(-1) ?? "";
      this.carrySegment = this.carry ? segment : void 0;
      for (const sentence of complete) {
        const claim = this.toClaim(sentence.trim(), {
          ...segment,
          startMs: Math.min(startSegment.startMs, segment.startMs)
        });
        if (claim) claims.push(claim);
      }
    }
    return claims;
  }
  async flush(context) {
    if (!this.carry) return [];
    const text = this.carry;
    const speaker = this.carrySegment?.speaker;
    this.carry = "";
    this.carrySegment = void 0;
    const claim = this.toClaim(text, {
      startMs: context.mediaTimeMs,
      endMs: context.mediaTimeMs,
      text,
      speaker
    });
    return claim ? [claim] : [];
  }
  counts = { sentences: 0, dropped: {} };
  stats() {
    return { sentences: this.counts.sentences, dropped: { ...this.counts.dropped } };
  }
  toClaim(text, segment) {
    this.counts.sentences += 1;
    const verdict = classifyClaim(text, { moderator: segment.speakerRole === "moderator" });
    if (!verdict.keep) {
      const reason = verdict.reason ?? "other";
      this.counts.dropped[reason] = (this.counts.dropped[reason] ?? 0) + 1;
      return void 0;
    }
    return {
      id: `claim-${this.nextId++}`,
      text,
      normalized: normalizeClaim(text),
      startMs: segment.startMs,
      endMs: segment.endMs,
      ...segment.speaker ? { speaker: segment.speaker } : {},
      ...segment.speakerConfidence !== void 0 ? { speakerConfidence: segment.speakerConfidence } : {},
      type: verdict.type,
      checkable: verdict.checkable
    };
  }
};
var HeuristicTopicGrouper = class {
  async group(claim, topics) {
    const tokens = [...new Set(contentTokens(claim.text))];
    let best;
    for (const topic2 of topics) {
      const union = /* @__PURE__ */ new Set([...tokens, ...topic2.tokens]);
      const overlap = tokens.filter((token) => topic2.tokens.includes(token));
      const score = union.size ? overlap.length / union.size : 0;
      if (!best || score > best.score) best = { topic: topic2, score };
    }
    if (best && best.score >= 0.34) {
      best.topic.claimIds.push(claim.id);
      best.topic.tokens = [.../* @__PURE__ */ new Set([...best.topic.tokens, ...tokens])];
      return best.topic;
    }
    const topic = {
      id: `topic-${topics.length + 1}`,
      title: tokens.slice(0, 3).map((token) => token[0]?.toUpperCase() + token.slice(1)).join(" "),
      tokens,
      claimIds: [claim.id]
    };
    topics.push(topic);
    return topic;
  }
};
function isCitedFact(fact) {
  if (!fact.sourceUrl) return false;
  try {
    const url = new URL(fact.sourceUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}
function pageClaim(claim) {
  return {
    id: claim.id,
    text: claim.text,
    startMs: claim.startMs,
    ...claim.speaker ? { speaker: claim.speaker } : {}
  };
}
function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
var HtmlPageBuilder = class {
  async build(input) {
    const facts = input.facts.filter(isCitedFact);
    const page = input.existingPage ? {
      ...input.existingPage,
      currentClaim: input.claim.text,
      currentSpeaker: input.claim.speaker,
      claimIds: [...input.existingPage.claimIds, input.claim.id],
      claims: [...input.existingPage.claims, pageClaim(input.claim)],
      facts: [...input.existingPage.facts, ...facts].filter(
        (fact, index, all) => all.findIndex(
          (candidate) => candidate.text === fact.text && candidate.sourceUrl === fact.sourceUrl
        ) === index
      ),
      updatedAtMs: input.claim.endMs
    } : {
      id: `page-${input.topic.id}`,
      topicId: input.topic.id,
      title: input.topic.title,
      currentClaim: input.claim.text,
      currentSpeaker: input.claim.speaker,
      claimIds: [input.claim.id],
      claims: [pageClaim(input.claim)],
      facts,
      createdAtMs: input.claim.endMs,
      updatedAtMs: input.claim.endMs
    };
    return {
      page,
      offeredFacts: input.facts.length,
      citedFacts: facts.length
    };
  }
  render(pages, timeline) {
    const sections = pages.map(
      (page, index) => `<section id="${escapeHtml(page.id)}" class="page">
  <p class="eyebrow">Topic ${index + 1} of ${pages.length}</p>
  <h1>${escapeHtml(page.title)}</h1>
  <p class="claim">${escapeHtml(page.currentClaim)}</p>${page.currentSpeaker ? `
  <p class="speaker">Said by ${escapeHtml(page.currentSpeaker)}</p>` : ""}${page.claims.length > 1 ? `
  <h2>Claims on this topic</h2>
  <ol class="claims">${page.claims.map(
        (claim) => `<li><time>${formatClock(claim.startMs)}</time> ${claim.speaker ? `<strong>${escapeHtml(claim.speaker)}:</strong> ` : ""}${escapeHtml(claim.text)}</li>`
      ).join("")}</ol>` : ""}
  <h2>Cited facts</h2>
  <ul>${page.facts.slice(0, 5).map((fact) => {
        const meta = [];
        if (fact.publisher) meta.push(escapeHtml(fact.publisher));
        if (fact.sourceTitle && !fact.publisher) meta.push(escapeHtml(fact.sourceTitle));
        if (fact.rating) meta.push(`Rating: ${escapeHtml(fact.rating)}`);
        const metaHtml = meta.length > 0 ? ` <span class="source-meta">(${meta.join(", ")})</span>` : "";
        const label = fact.provider === "google-fact-check" ? "Fact check" : "Source";
        return `<li>${escapeHtml(fact.text)}${metaHtml} <a href="${escapeHtml(fact.sourceUrl)}">${label}</a></li>`;
      }).join("")}</ul>
  <h2>Why it matters</h2>
  <p>This topic was selected because it contains a concrete claim worth checking.</p>
</section>`
    ).join("\n");
    const markers = timeline.filter((event) => event.type.startsWith("page-")).map(
      (event) => `<li><time>${(event.mediaMs / 1e3).toFixed(1)}s</time> ${escapeHtml(event.detail)}${event.claim ? `<br><span class="said">${event.speaker ? `<strong>${escapeHtml(event.speaker)}:</strong> ` : ""}${escapeHtml(event.claim)}</span>` : ""}</li>`
    ).join("");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>CONTXT replay deck</title><style>
:root{color:#24211d;background:#f7f0e4;font:18px/1.55 system-ui,sans-serif}body{margin:0}
nav{position:fixed;inset:auto 0 0;display:flex;justify-content:center;gap:1rem;padding:1rem;background:#f7f0e4e8}
.page{min-height:82vh;padding:8vh max(8vw,2rem);scroll-snap-align:start}.claim{font-size:1.5rem;max-width:50rem}
.eyebrow,time,.speaker{color:#6d5843}.speaker{margin-top:-.5rem;font-weight:600}.said{color:#4a4038}a{color:#714214}main{scroll-snap-type:y mandatory}
.timeline{padding:3rem max(8vw,2rem) 7rem}li{margin:.7rem 0}
</style></head><body><main>${sections || '<section class="page"><h1>No topics yet</h1></section>'}
<section class="timeline"><h1>Chronological timeline</h1><ol>${markers}</ol></section></main>
<nav><button type="button" onclick="move(-1)">Previous</button><button type="button" onclick="move(1)">Next</button></nav>
<script>const pages=[...document.querySelectorAll(".page")];let current=0;function move(step){current=Math.max(0,Math.min(pages.length-1,current+step));pages[current]?.scrollIntoView({behavior:"smooth"})}<\/script>
</body></html>`;
  }
};

// harness/pipeline.ts
function summarizeLatency(samples) {
  return Object.fromEntries(
    Object.entries(samples).map(([stage, values]) => [
      stage,
      {
        count: values.length,
        totalMs: Number(values.reduce((sum, value) => sum + value, 0).toFixed(3)),
        averageMs: Number(
          (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)
        ),
        maxMs: Number(Math.max(...values).toFixed(3))
      }
    ])
  );
}
function createPipelineSession(config) {
  const started = globalThis.performance.now();
  const timeline = [];
  const topics = [];
  const pages = /* @__PURE__ */ new Map();
  const claimIndex = new ClaimIndex();
  const topicByMergedClaim = /* @__PURE__ */ new Map();
  const latencySamples = {
    transcriber: [],
    claimExtractor: [],
    topicGrouper: [],
    researcher: [],
    pageBuilder: []
  };
  const claimToPageSeconds = [];
  const claimsSeen = [];
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let duplicatesMerged = 0;
  let factsProposed = 0;
  let factsDroppedForNoSource = 0;
  const record = (mediaMs, stage, type, detail, refId, latencyMs, claim) => {
    timeline.push({
      atMs: Number((globalThis.performance.now() - started).toFixed(3)),
      mediaMs,
      stage,
      type,
      detail,
      refId,
      latencyMs,
      ...claim?.speaker ? { speaker: claim.speaker } : {},
      ...claim ? { claim: claim.text } : {}
    });
  };
  const timed = async (stage, work) => {
    const before = globalThis.performance.now();
    const result = await work();
    latencySamples[stage].push(globalThis.performance.now() - before);
    return result;
  };
  const processClaim = async (claim) => {
    const claimReceived = globalThis.performance.now();
    claimsSeen.push(claim);
    const { merged, isRepeat } = claimIndex.add({
      claimId: claim.id,
      startMs: claim.startMs,
      endMs: claim.endMs,
      text: claim.text,
      ...claim.speaker ? { speaker: claim.speaker } : {}
    });
    if (isRepeat) duplicatesMerged += 1;
    if (claim.checkable === false) {
      record(
        claim.endMs,
        "claimExtractor",
        isRepeat ? "repeat-not-checkable" : "claim-not-checkable",
        claim.type ?? "not checkable",
        merged.id,
        void 0,
        claim
      );
      return;
    }
    const priorTopicId = topicByMergedClaim.get(merged.id);
    const priorTopic = priorTopicId ? topics.find((candidate) => candidate.id === priorTopicId) : void 0;
    const topic = priorTopic ?? await timed("topicGrouper", () => config.grouper.group(claim, topics));
    if (priorTopic) priorTopic.claimIds.push(claim.id);
    topicByMergedClaim.set(merged.id, topic.id);
    record(claim.endMs, "topicGrouper", "topic-grouped", topic.title, topic.id, void 0, claim);
    const existingPage = pages.get(topic.id);
    let facts = [];
    if (priorTopic) {
      record(
        claim.endMs,
        "dedupe",
        "duplicate-merged",
        claim.text,
        existingPage?.id,
        void 0,
        claim
      );
    } else {
      const proposedFacts = await timed(
        "researcher",
        () => config.researcher.research(claim, topic)
      );
      factsProposed += proposedFacts.length;
      facts = proposedFacts.filter(isCitedFact);
      factsDroppedForNoSource += proposedFacts.length - facts.length;
    }
    const built = await timed(
      "pageBuilder",
      () => config.pageBuilder.build({ claim, topic, facts, existingPage })
    );
    pages.set(topic.id, built.page);
    const action = existingPage ? "updated" : "created";
    if (existingPage) pagesUpdated += 1;
    else pagesCreated += 1;
    const seconds = (globalThis.performance.now() - claimReceived) / 1e3;
    claimToPageSeconds.push({
      claimId: claim.id,
      pageId: built.page.id,
      action,
      seconds: Number(seconds.toFixed(6)),
      ...claim.speaker ? { speaker: claim.speaker } : {}
    });
    record(
      claim.endMs,
      "pageBuilder",
      `page-${action}`,
      `${action === "created" ? "Created" : "Updated"} ${built.page.title}`,
      built.page.id,
      seconds * 1e3,
      claim
    );
  };
  const processSegments = async (segments, mediaTimeMs) => {
    const claims = await timed(
      "claimExtractor",
      () => config.extractor.extract(segments, { mediaTimeMs })
    );
    for (const claim of claims) await processClaim(claim);
  };
  const flushExtractor = async (mediaTimeMs) => {
    const remaining = await timed(
      "claimExtractor",
      () => config.extractor.flush({ mediaTimeMs })
    );
    for (const claim of remaining) await processClaim(claim);
  };
  const snapshot = () => ({
    timeline: timeline.map((event) => ({ ...event })),
    pages: [...pages.values()].map((page) => ({
      ...page,
      claimIds: [...page.claimIds],
      claims: page.claims.map((claim) => ({ ...claim })),
      facts: page.facts.map((fact) => ({ ...fact }))
    })),
    pagesCreated,
    pagesUpdated,
    factsProposed,
    researchRequests: config.researchHandle.stats().requests
  });
  const finalize = async (transcriberStatus, skipReason) => {
    for (const [stage, values] of Object.entries(latencySamples)) {
      if (values.length === 0) delete latencySamples[stage];
    }
    const claimById = new Map(claimsSeen.map((claim) => [claim.id, claim]));
    const pageList = [...pages.values()];
    const factsOnPages = pageList.flatMap((page) => page.facts);
    const factsOnPagesCited = factsOnPages.filter(isCitedFact).length;
    const researchStats = config.researchHandle.stats();
    const researchAvailability = await config.researchHandle.status();
    const scorecard = {
      runId: config.runId,
      ingestionMode: config.ingestionMode,
      transcriber: config.transcriberId,
      transcriberStatus,
      researcher: config.researchHandle.id,
      researcherStatus: researchAvailability.status,
      researchRequests: researchStats.requests,
      researchCacheHits: researchStats.cacheHits,
      claimsResearched: researchStats.claimsResearched,
      claimsSkippedNonCheckable: researchStats.claimsSkippedNonCheckable,
      speed: config.speed,
      chunkMs: config.chunkMs,
      durationMs: config.durationMs,
      pagesCreated,
      pagesUpdated,
      duplicatesMerged,
      factsProposed,
      factsDroppedForNoSource,
      factsOnPagesCitedPercent: factsOnPages.length ? factsOnPagesCited / factsOnPages.length * 100 : 100,
      latencyByStageMs: summarizeLatency(latencySamples),
      claimToPageSeconds,
      claimStats: {
        ...config.extractor.stats?.() ?? {},
        claimsExtracted: claimsSeen.length,
        uniqueClaims: claimIndex.merged.length,
        repeatsMerged: claimsSeen.length - claimIndex.merged.length,
        checkableUnique: claimIndex.merged.filter(
          (merged) => claimById.get(merged.id)?.checkable !== false
        ).length,
        uniqueByType: claimIndex.merged.reduce((counts, merged) => {
          const type = claimById.get(merged.id)?.type ?? "untyped";
          counts[type] = (counts[type] ?? 0) + 1;
          return counts;
        }, {})
      },
      claimsBySpeaker: Object.fromEntries(
        [...new Set(claimsSeen.map((claim) => claim.speaker ?? "unknown"))].map(
          (speaker) => [
            speaker,
            claimsSeen.filter((claim) => (claim.speaker ?? "unknown") === speaker).length
          ]
        )
      ),
      ...skipReason ? { skipReason } : {}
    };
    await config.researchHandle.flush?.();
    if (config.persist === false) {
      return {
        runDir: config.runDir,
        deckPath: "",
        timelinePath: "",
        scorecardPath: "",
        claimsPath: "",
        scorecard,
        timeline,
        pages: pageList
      };
    }
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const deckPath = join(config.runDir, "deck.html");
    const timelinePath = join(config.runDir, "timeline.json");
    const scorecardPath = join(config.runDir, "scorecard.json");
    const claimsPath = join(config.runDir, "claims.json");
    const claimsOut = claimIndex.merged.map((merged) => {
      const first = claimById.get(merged.id);
      return {
        id: merged.id,
        type: first.type ?? null,
        checkable: first.checkable ?? true,
        speaker: first.speaker ?? null,
        ...first.speakerConfidence !== void 0 ? { speakerConfidence: first.speakerConfidence } : {},
        startMs: first.startMs,
        endMs: first.endMs,
        text: first.text,
        topicId: topicByMergedClaim.get(merged.id) ?? null,
        occurrences: merged.occurrences
      };
    });
    await Promise.all([
      writeFile(claimsPath, `${JSON.stringify(claimsOut, null, 2)}
`),
      writeFile(deckPath, config.pageBuilder.render(pageList, timeline)),
      writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}
`),
      writeFile(scorecardPath, `${JSON.stringify(scorecard, null, 2)}
`)
    ]);
    return {
      runDir: config.runDir,
      deckPath,
      timelinePath,
      scorecardPath,
      claimsPath,
      scorecard,
      timeline,
      pages: pageList
    };
  };
  return {
    ...config,
    started,
    record,
    timed,
    processClaim,
    processSegments,
    flushExtractor,
    snapshot,
    finalize
  };
}

// pipeline/words.ts
var SENTENCE_END = /[.?!]["'”’)\]]?$/;
var ABBREVIATION = /^(?:Mr|Mrs|Ms|Dr|St|Sr|Jr|Gov|Sen|Rep|Gen|Lt|Col|Prof|Mt|vs|etc|U\.S|D\.C)\.$/i;
function wordsToSegments(words, minWords = 4) {
  const segments = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    segments.push({
      startMs: first.startMs,
      endMs: current.at(-1).endMs,
      text: current.map((word) => word.text).join(" "),
      ...first.speaker ? { speaker: first.speaker } : {}
    });
    current = [];
  };
  for (const word of words) {
    if (current.length > 0 && current.at(-1).speaker !== word.speaker) flush();
    current.push(word);
    if (SENTENCE_END.test(word.text) && !ABBREVIATION.test(word.text) && current.length >= minWords) {
      flush();
    }
  }
  flush();
  return segments;
}
function deepgramToSegments(response) {
  const words = response.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return wordsToSegments(
    words.map((word) => ({
      text: word.punctuated_word ?? word.word,
      startMs: Math.round(word.start * 1e3),
      endMs: Math.round(word.end * 1e3),
      ...word.speaker !== void 0 ? { speaker: `Speaker ${word.speaker}` } : {}
    }))
  );
}

// pipeline/mic.ts
var DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";
var PHASE_COPY = {
  idle: "Microphone is idle. Start it when you are ready to speak.",
  "requesting-permission": "Waiting for microphone permission.",
  denied: "The browser blocked the microphone. Allow microphone access for this site in the address bar, then try again.",
  "no-device": "No microphone was found. Connect one and try again.",
  insecure: "The microphone needs a secure page. Open this site over HTTPS, or on localhost.",
  connecting: "Connecting to live speech.",
  live: "Listening. Speak in full sentences.",
  reconnecting: "Connection dropped. Reconnecting.",
  "token-missing": "Live speech is not connected on this site yet. The microphone needs a token server before it can start.",
  "token-error": "The speech token server did not respond. Check the server configuration, then try again.",
  stopped: "Microphone stopped.",
  error: "The microphone could not start. Try again."
};
function micNotice(phase, message) {
  return { phase, message: message ?? PHASE_COPY[phase] };
}
function describeMicFailure(error) {
  const name = error.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return micNotice("denied");
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return micNotice("no-device");
  if (name === "NotReadableError" || name === "TrackStartError") {
    return micNotice("error", "The microphone is busy in another app. Close that app and try again.");
  }
  if (name === "SecurityError") return micNotice("insecure");
  if (name === "OverconstrainedError") {
    return micNotice("error", "This browser could not open a single-channel microphone. Try another browser.");
  }
  return micNotice("error");
}
function isSafeTokenUrl(tokenUrl) {
  const value = tokenUrl.trim();
  if (!value || value.length > 500) return false;
  if (/api[_-]?key|access_token|secret|password|bearer/i.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "http:" && local;
  } catch {
    return false;
  }
}
function deepgramBrowserListenUrl(options = {}) {
  const params = new URLSearchParams({
    model: options.model ?? "nova-3",
    language: "en",
    encoding: "linear16",
    sample_rate: String(options.sampleRate ?? 16e3),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    vad_events: "true",
    endpointing: "300",
    utterance_end_ms: "1000"
  });
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`;
}
function browserListenProtocols(accessToken) {
  const token = accessToken.trim();
  if (!token || token.length > 4096) throw new Error("Speech token is missing");
  if (/[\s,]/.test(token)) throw new Error("Speech token cannot travel in a WebSocket subprotocol");
  return ["bearer", token];
}
function readDeepgramListenEvent(payload) {
  let message;
  try {
    message = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    return { kind: "ignore" };
  }
  if (!message || typeof message !== "object") return { kind: "ignore" };
  if (message.type === "UtteranceEnd") return { kind: "utterance_end" };
  if (message.type === "SpeechStarted") return { kind: "speech_started" };
  if (message.type !== "Results") return { kind: "ignore" };
  const alternative = message.channel?.alternatives?.[0];
  const text = (alternative?.transcript ?? "").trim();
  if (!text) return { kind: "ignore" };
  if (!message.is_final) return { kind: "partial", text };
  const wrapped = {
    results: { channels: [{ alternatives: [alternative ?? {}] }] }
  };
  let segments = deepgramToSegments(wrapped);
  if (segments.length === 0) {
    const startMs = Math.round(Number(message.start ?? 0) * 1e3);
    const endMs = startMs + Math.round(Number(message.duration ?? 0) * 1e3);
    segments = [{ startMs, endMs: endMs || startMs, text }];
  }
  return { kind: "final", text, segments };
}
function downsampleBox(samples, fromRate, toRate = 16e3) {
  if (fromRate <= 0 || toRate <= 0) throw new Error("Sample rates must be positive");
  if (fromRate === toRate) return Float32Array.from(samples);
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  let bucket = 0;
  let count = 0;
  let index = 0;
  for (let i = 0; i < samples.length; i += 1) {
    bucket += samples[i] ?? 0;
    count += 1;
    if (count >= ratio) {
      if (index < out.length) out[index] = bucket / count;
      index += 1;
      bucket = 0;
      count = 0;
    }
  }
  return out.subarray(0, index);
}
function floatToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

// pipeline/research.ts
var SNIPPET_MAX = 280;
var QUERY_MAX = 400;
function buildResearchQuery(claim, topic) {
  const parts = [claim.text.trim()];
  const title = topic.title.trim();
  if (title && !claim.text.toLowerCase().includes(title.toLowerCase())) {
    parts.push(title);
  }
  const query = parts.join(". ");
  return query.length > QUERY_MAX ? `${query.slice(0, QUERY_MAX - 1)}\u2026` : query;
}
function factTextFromHit(hit) {
  const content = (hit.content ?? "").trim();
  const title = (hit.title ?? "").trim();
  if (content && title && !content.toLowerCase().startsWith(title.toLowerCase())) {
    const combined = `${title}. ${content}`;
    return combined.length > SNIPPET_MAX ? `${combined.slice(0, SNIPPET_MAX - 1)}\u2026` : combined;
  }
  const primary = content || title || hit.url;
  return primary.length > SNIPPET_MAX ? `${primary.slice(0, SNIPPET_MAX - 1)}\u2026` : primary;
}
function hitsToFacts(hits, maxFacts) {
  const seen = /* @__PURE__ */ new Set();
  const facts = [];
  for (const hit of hits) {
    if (!hit.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    const text = factTextFromHit(hit);
    if (!text) continue;
    facts.push({ text, sourceUrl: hit.url });
    if (facts.length >= maxFacts) break;
  }
  return facts;
}
async function loadCache(path) {
  if (!path) return {};
  try {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}
async function saveCache(path, cache) {
  if (!path) return;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, `${JSON.stringify(cache, null, 2)}
`);
}
var WebResearcher = class {
  constructor(options) {
    this.options = options;
    this.id = `web:${options.provider.id}`;
  }
  options;
  id;
  cache = {};
  cacheLoaded = false;
  dirty = false;
  async ensureCache() {
    if (this.cacheLoaded) return;
    this.cache = await loadCache(this.options.cachePath);
    this.cacheLoaded = true;
  }
  recordRequest() {
    if (this.options.stats) this.options.stats.requests += 1;
  }
  recordCacheHit() {
    if (this.options.stats) this.options.stats.cacheHits += 1;
  }
  async research(claim, topic) {
    await this.ensureCache();
    const key = claim.normalized;
    if (key in this.cache) {
      this.recordCacheHit();
      return this.cache[key] ?? [];
    }
    this.recordRequest();
    const maxFacts = this.options.maxFacts ?? 5;
    const query = buildResearchQuery(claim, topic);
    let facts = [];
    try {
      const hits = await this.options.provider.search(query, maxFacts);
      facts = hitsToFacts(hits, maxFacts).filter(isCitedFact);
    } catch {
      facts = [];
    }
    this.cache[key] = facts;
    this.dirty = true;
    await saveCache(this.options.cachePath, this.cache);
    return facts;
  }
  async flushCache() {
    if (this.dirty && this.options.cachePath) {
      await saveCache(this.options.cachePath, this.cache);
    }
  }
};

// pipeline/wikipedia.ts
function stripHtml(value) {
  return value.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
var WikipediaSearchProvider = class {
  constructor(fetchImpl = fetch) {
    this.fetchImpl = fetchImpl;
  }
  fetchImpl;
  id = "wikipedia";
  async search(query, maxResults) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", query.slice(0, 300));
    url.searchParams.set("srlimit", String(Math.min(Math.max(maxResults, 1), 5)));
    url.searchParams.set("srprop", "snippet");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    url.searchParams.set("utf8", "1");
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Wikipedia search failed: HTTP ${response.status}`);
    const body = await response.json();
    return (body.query?.search ?? []).filter((row) => row.title).map((row) => {
      const title = row.title.replace(/ /g, "_");
      return {
        title: row.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        content: stripHtml(row.snippet ?? "")
      };
    });
  }
};

// web/mic/browser.ts
function createMicrophonePipeline(fetchImpl = fetch) {
  const stats = {
    requests: 0,
    cacheHits: 0,
    claimsResearched: 0,
    claimsSkippedNonCheckable: 0
  };
  const researcher = new WebResearcher({
    provider: new WikipediaSearchProvider(fetchImpl),
    maxFacts: 3,
    stats
  });
  const session = createPipelineSession({
    runId: "microphone",
    runDir: "memory",
    speed: 1,
    chunkMs: 0,
    durationMs: 0,
    ingestionMode: "live",
    transcriberId: "deepgram-browser",
    persist: false,
    researchHandle: {
      id: "wikipedia",
      researcher,
      async status() {
        return { status: "ok" };
      },
      stats: () => stats,
      flush: () => researcher.flushCache()
    },
    extractor: new HeuristicClaimExtractor(),
    grouper: new HeuristicTopicGrouper(),
    researcher,
    pageBuilder: new HtmlPageBuilder()
  });
  return { session, stats, researcherId: "wikipedia" };
}
export {
  browserListenProtocols,
  createMicrophonePipeline,
  deepgramBrowserListenUrl,
  describeMicFailure,
  downsampleBox,
  floatToInt16,
  isSafeTokenUrl,
  micNotice,
  readDeepgramListenEvent
};
