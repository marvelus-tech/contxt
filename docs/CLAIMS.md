# CONTXT milestone 2: claim extraction on real speech

Run on 9 Nov 2026 (Melbourne time, AEDT). The source is the 15:35 clip of the 1992 debate.

I tested on five real transcripts, using the raw responses in `bakeoff/raw/`:
- Deepgram nova-3, two runs: WAV, and Opus with keyterms.
- AssemblyAI universal-3-pro, one run (WAV).
- AssemblyAI universal-3-5-pro, two runs: WAV and Opus.

Every run started from generic labels (`Speaker A`, `Speaker 0`) with no reference names. To reproduce:

```bash
npm run eval:claims        # writes out/eval/* and bakeoff/eval_claims.json
```

## 1. Speaker naming

`pipeline/speakers.ts` maps generic labels to names. It uses four cues:
- **Self-introductions:** "I am Jim Lehrer".
- **Forward address:** the last name said before the floor changes hands, as in "Mr. Perot, what do you believe...", "Governor Clinton, a one minute response" or "It will be asked by Ann Compton".
- **Reply address:** "Good evening, Jim."
- **Third-person mentions:** inside a long answer, a mention like "Governor Clinton says..." counts against the speaker being that person.

Candidate names come from titles, full names and introductions in the talk itself, or from `--speakers "A,B,C"` hints. Each name goes to at most one label. A label below 0.4 confidence keeps its generic name, and its confidence value is still reported.

Accuracy against the reference mapping (the alignment in `bakeoff/scores.json`):

| Run | No hints, exact | No hints, right person* | Words given to the right person | With hints |
|---|---|---|---|---|
| Deepgram nova-3 (WAV) | 4/5 | 5/5 | 100% | 5/5 |
| Deepgram nova-3 + keyterms (Opus) | 5/5 | 5/5 | 100% | 5/5 |
| AssemblyAI universal-3-pro (WAV) | 5/5 | 5/5 | 100% | 5/5 |
| AssemblyAI universal-3-5-pro (WAV) | 5/5 | 5/5 | 100% | 5/5 |
| AssemblyAI universal-3-5-pro (Opus) | 4/5 | 4/5 | 98.4% | 4/5 |

\* "Right person" means the label went to the right speaker even though the name is misspelled. Deepgram without keyterms calls the moderator "Jim Lara", which keyterms or hints fix.

- **Fallback case:** in the AssemblyAI Opus run, the words "Ann Compton" fell out of the moderator's handover ("It will be asked by..."), so nothing named her. Her label stays `Speaker E` with confidence 0. That's the designed fallback, not a wrong name.
- **Confidence:** 1.0 for the three candidates, 0.74 to 0.87 for the moderator, and 0.66 for the panelist.
- **Moderator role:** "I will be the moderator" marks the moderator role. Sentences from the moderator are treated as procedural unless they carry a statistic.

## 2. Number normalisation

`pipeline/numbers.ts` turns spoken numbers into digits before claims are checked or matched. Examples:
- "four trillion dollars", "$4 trillion" and "$4,000,000,000,000" all become `4000000000000`.
- "five and a half million" becomes `5500000`.
- "nineteen sixty nine" becomes `1969`.
- "first to thirteenth" becomes `1st to 13th`.
- "the late seventies" becomes `70s`.

A lone "one" or "first" doesn't count as a figure. A statistic needs a figure of 10 or more, a rank or decade, a multiplier ("twice"), or a small number with a unit.

**Claim counts before and after this branch.** Both columns use the same generic-label transcripts.

| Run | Step 2 (main) | This branch, claims kept | This branch, unique checkable |
|---|---|---|---|
| Deepgram nova-3 (WAV) | 62 | 125 | 52 |
| Deepgram nova-3 + keyterms (Opus) | 61 | 125 | 51 |
| AssemblyAI universal-3-pro (WAV) | 87 | 126 | 56 |
| AssemblyAI universal-3-5-pro (WAV) | 87 | 128 | 58 |
| AssemblyAI universal-3-5-pro (Opus) | 88 | 126 | 58 |

- **Before:** Deepgram found 30% fewer claims than AssemblyAI, because it spells numbers out.
- **After:** claims kept are within 3 (2%) across all five runs.
- **Checkable claims:** within about 10% (51 to 52 against 56 to 58). The gap is a few factual sentences that Deepgram punctuates differently.
- **Cross-provider match:** comparing Deepgram WAV with AssemblyAI universal-3-5-pro WAV, 49 of 52 Deepgram checkable claims have a matching checkable claim in the AssemblyAI run, and 50 of 58 match the other way.

## 3. Claim quality

**Before and after, using the AssemblyAI universal-3-5-pro (WAV) run:**
- **Step 2:** 87 claims. They were all untyped and all went to pages, including lines like "President Bush, 1 minute to respond." and "Tonight I say to the president, Mr." (cut off at "Mr.").
- **This branch:**
  - 183 sentences.
  - 55 dropped:
    - 30 procedural (moderator handovers, format, timing)
    - 18 filler
    - 6 questions
    - 1 greeting
  - 128 claims kept.
  - 127 unique after merging (1 repeat merged).
  - By type: 17 statistic, 41 factual, 51 opinion, 9 promise, 9 prediction.
  - **58 checkable.** Only checkable claims go to research and pages, but every claim is listed in `claims.json` with its type.
- **Sentence fix:** sentences no longer split after "Mr.", "St." and other titles.
- **Repeats:** these merge across the whole recording, and every occurrence keeps its timestamp and speaker. In this clip Clinton restates "$200,000 and above" at 13:49 and again at 14:21, so that claim has 2 occurrences. A shared figure alone isn't enough to merge: "12 years" in two different sentences stays separate.

### Ten sample claims

From the AssemblyAI universal-3-5-pro Opus run, with speakers named automatically from generic labels:

| Time | Speaker | Type | Checkable | Claim |
|---|---|---|---|---|
| 1:46 | Ross Perot | statistic | yes | I think the principal issue that separates me Is that 5.5 million people came together on their own and put me on the ballot. |
| 5:46 | Bill Clinton | statistic | yes | We have gone from 1st to 13th in the world in wages in the last 12 years. |
| 7:53 | Ross Perot | statistic | yes | I don't have any experience in running up a $4 trillion debt. |
| 15:28 | Bill Clinton | statistic | yes | We're down 35,000 jobs in the private sector. |
| 12:29 | Bill Clinton | factual | yes | You have questioned my patriotism. |
| 13:02 | Bill Clinton | factual | yes | And a senator from Connecticut stood up to him named Prescott Bush. |
| 4:17 | George Bush | promise | no | I'll sit down with them, Democrats and Republicans alike, and work for my agenda for American renewal, which represents real change. |
| 13:20 | Bill Clinton | promise | no | I want to lead a unified country. |
| 6:26 | Bill Clinton | prediction | no | Mine is rooted in the real lives of real people, and it will bring real results if we have the courage to change. |
| 8:55 | George Bush | opinion | no | I think character is a very important question. |

The Deepgram run gets the same Perot line as "I don't have any experience in running up a $4,000,000,000,000 debt.", also tagged statistic and checkable.

## Open

- **The classifier is rule-based.** Some edges are wrong:
  - "I want to accurately quote him" is tagged promise.
  - "Kids go to bed at night without the same fear of nuclear war" is tagged opinion.
  - Conditional "would" sentences tend to become predictions.
  - An LLM classifier behind the same `ClaimExtractor` interface is the natural next step. That's milestone 3 or later.
- **Naming needs address cues.** It depends on a moderator or a debate-style handover. Interviews and panels without names said aloud will mostly fall back to generic labels, which is by design. `--speakers` hints help only when a name is actually said.
- **Short clip.** A 15-minute clip has only one real repeat, so merging needs a longer test, such as the full 90 minutes.
