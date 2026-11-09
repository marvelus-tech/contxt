// Spoken-number handling so "four trillion dollars", "$4 trillion" and
// "$4,000,000,000,000" are all recognised as the same checkable figure.

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = {
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, fiftieth: 50, hundredth: 100,
};

function isNumberWord(word: string): boolean {
  return (
    word in UNITS || word in TENS || word in SCALES || word === "hundred"
  );
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
}

/** Parses a run of number words ("four", "trillion", "and", "a", "half"). */
function parseWords(words: string[]): number | undefined {
  let total = 0;
  let current = 0;
  let seen = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word in UNITS) current += UNITS[word]!;
    else if (word in TENS) current += TENS[word]!;
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word in SCALES) {
      total += (current || 1) * SCALES[word]!;
      current = 0;
    } else if (word === "and" || word === "a") continue;
    else if (word === "half") current += 0.5;
    else return undefined;
    seen = true;
  }
  return seen ? total + current : undefined;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

/**
 * Rewrites spelled-out numbers as digits, keeping the rest of the text.
 * "four trillion dollars" becomes "4000000000000 dollars", "$4 trillion"
 * becomes "4000000000000 dollars", "five and a half million" becomes
 * "5500000", "nineteen sixty nine" becomes "1969", and "thirteenth" becomes "13th".
 */
export function digitizeNumbers(text: string): string {
  let out = text
    // "$4 trillion" / "$1.5 billion" / "4 trillion"
    .replace(
      /\$?(\d+(?:\.\d+)?)\s+(thousand|million|billion|trillion)\b/gi,
      (match, value: string, scale: string) =>
        `${match.startsWith("$") ? "$" : ""}${formatNumber(Number(value) * SCALES[scale.toLowerCase()]!)}`,
    )
    .replace(/\$(\d[\d,]*(?:\.\d+)?)/g, (_m, value: string) => `${value.replace(/,/g, "")} dollars`)
    .replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) => m.replace(/,/g, ""))
    .replace(/(\d)\s*%/g, "$1 percent");

  // Decades: "the late seventies" -> "the late 70s", "nineteen eighties" -> "1980s".
  out = out.replace(
    /\b(?:(nineteen|twenty)[\s-]+)?(twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b/gi,
    (_match, century: string | undefined, decade: string) => {
      const tens = TENS[decade.toLowerCase().replace(/ies$/, "y")]!;
      const prefix = century ? (century.toLowerCase() === "nineteen" ? "19" : "20") : "";
      return `${prefix}${tens}s`;
    },
  );

  // Years said as two pairs: "nineteen sixty nine", "nineteen ninety two".
  out = out.replace(
    /\b(nineteen|twenty)[\s-]+(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?\b/gi,
    (match, century: string, tens: string, unit?: string) => {
      const lower = tens.toLowerCase();
      const prefix = century.toLowerCase() === "nineteen" ? 1900 : 2000;
      const rest = (UNITS[lower] ?? TENS[lower] ?? 0) + (unit ? UNITS[unit.toLowerCase()]! : 0);
      // "twenty twenty" style only when it reads like a year; leave counts alone.
      if (prefix === 2000 && !(lower in TENS)) return match;
      return String(prefix + rest);
    },
  );

  const tokens = out.split(/(\s+|(?<=\w)-(?=\w))/);
  const result: string[] = [];
  let run: string[] = [];
  let runRaw: string[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    // Connector words at the end belong to the sentence, not the number.
    const tail: string[] = [];
    while (run.length && ["and", "a", "half"].includes(run.at(-1)!) &&
      !(run.at(-1) === "half" && run.at(-2) === "a")) {
      run.pop();
      tail.unshift(runRaw.pop()!);
    }
    const value = run.length ? parseWords(run) : undefined;
    // "a hundred", "a million": absorb the article into the number.
    if (value !== undefined && (run[0] === "hundred" || run[0]! in SCALES)) {
      const last = result.length - 1;
      const article = result[last - 1];
      if (/^\s+$/.test(result[last] ?? "") && article?.toLowerCase() === "a") {
        result.splice(last - 1, 2);
      }
    }
    if (value !== undefined) result.push(formatNumber(value));
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
    if (word && (isNumberWord(word) || (run.length > 0 && ["and", "a", "half"].includes(word)))) {
      run.push(word);
      runRaw.push(match![1]!);
      if (match![2]) {
        flush();
        result.push(match![2]!);
      }
      continue;
    }
    if (run.length) {
      flush();
      result.push(" ");
    }
    const ordinal = word ? ORDINALS[word] : undefined;
    // "second" is usually time or sequence, not a rank.
    if (ordinal !== undefined && word !== "second") {
      result.push(`${ordinal}${ordinalSuffix(ordinal)}${match![2] ?? ""}`);
    } else result.push(token);
  }
  flush();
  return result.join("").replace(/[ \t]{2,}/g, " ").replace(/ ([,.;:!?])/g, "$1").trim();
}

/** Numeric figures in a sentence, after digitizing. */
export function extractFigures(text: string): string[] {
  return [...digitizeNumbers(text).matchAll(/\b\d+(?:\.\d+)?(?:st|nd|rd|th|s)?\b/g)].map((m) => m[0]);
}

/**
 * True when the sentence carries a figure worth checking. A lone "one" and the
 * word "first" are too common as pronoun and sequence words to count.
 */
export function hasNumber(text: string): boolean {
  const cleaned = text
    .replace(/\b(one|first)\b(?![\s-]+(hundred|thousand|million|billion|trillion|percent))/gi, "")
    .replace(/\b(1st|one)\b/gi, "");
  return (
    extractFigures(cleaned).some((figure) => figure !== "1") ||
    /\b(?:twice|double|triple|tripled|doubled|halved|percent)\b/i.test(text)
  );
}

/**
 * True when the figure is a real statistic rather than a small count:
 * a number of 10 or more, a decade or ordinal rank, a multiplier, or a small
 * number with a unit (percent, dollars, years, million).
 */
export function hasStatistic(text: string): boolean {
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
