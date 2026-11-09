# CONTXT milestone 1: real audio in

Run on 9 Nov 2026 (Melbourne time, AEDT).

## Clip

- **Source:** [Wikimedia Commons, 11 Oct 1992 debate](https://commons.wikimedia.org/wiki/File:Presidential_Debate_with_George_H._W._Bush,_Bill_Clinton_and_Ross_Perot_11_October_1992.webm). It's public domain. I used the 240p VP9/Opus transcode (196 MB, 1:58:43) because we only need the audio.
- **Span in the source:** 00:02:06.0 to 00:17:41.4, which is **15:35.4** (935.4 s).
  - The start skips the 2 minutes of pre-air chatter ("About thirty seconds, we'll be going on the air"). Lehrer's "Good evening, and welcome..." begins 0.6 s into the clip.
  - The end is a clean turn boundary: Clinton's "...and that's what I want to do." The next words are Lehrer's "President Bush, one minute, sir."
- **Content:** Lehrer's opening, the "what separates you" round (Perot, Clinton, Bush), the experience exchange, Perot's "$4 trillion debt" line, the patriotism exchange, and Ann Compton's taxes question to Clinton.
- **Files:** `clip.wav` (16 kHz mono PCM), `clip.mp3` (64 kbps) and `clip.opus` (32 kbps).
- **Reference:** the debates.org first-half transcript, cut to the same span. That's 30 turns, 2,710 words and 5 speakers: LEHRER, PEROT, CLINTON, BUSH and COMPTON. I removed one "(Inaudible)" Bush interjection.
  - Files: `reference/reference.txt` and `reference/reference_turns.json`.

## Results

| | Deepgram nova-3 | AssemblyAI universal-3-pro | AssemblyAI universal-3-5-pro |
|---|---|---|---|
| WER (normalised) | 4.21% | **3.16%** | 3.78% |
| Substitutions / deletions / insertions | 47 / 32 / 37 | 30 / 23 / 34 | 30 / 26 / 48 |
| Speakers found (5 in the clip) | 5 | 5 | 5 |
| Words given to the right speaker | 100% | 99.93% (2 words wrong) | 99.93% |
| Speaker turns (reference has 30) | 29 | 29 | 29 |
| Turn order match | 0.92 | 0.92 | 0.92 |
| Wall-clock time for 15.6 min of audio | 30.6 s (WAV sent inline) | 15.9 s (3.7 s of that is upload) | 13.1 s |
| Billed duration | 935.4 s | 936 s | 936 s |
| List price | $0.0043/min, diarization included | about $0.23/hr (model plus diarization)* | $0.21/hr + $0.02/hr diarization |
| Cost of this clip | **$0.067** | about $0.060 | $0.060 |

\* universal-3-pro isn't listed on the current pricing page, so I assumed the universal-3-5-pro rate.

**Speakers.** All three runs found exactly 5 speakers: Lehrer, Perot, Clinton, Bush and Compton. Their turns line up almost perfectly with the reference.
- Two turn differences are the same in every run. Each run adds the candidates' "Good evening, Jim", which the reference leaves out. Each run also misses Bush's inaudible interjection during Clinton's patriotism answer.
- That leaves about one other turn difference: a short Compton follow-up merged into the next turn.

**WER notes.**
- The debates.org transcript is lightly edited, not verbatim. For example, it has "the principal that separates me" where the audio is "principal issue". It also drops fillers and false starts. That means about 2 to 3% of the measured error comes from the reference itself. The real gap between the providers is the useful signal.
- Before scoring, I normalised the text: lowercase, no punctuation, digits written as words, "$X" read as "X dollars", ordinals, "5.5 million" read as "five and a half million", Mr. read as mister, wanna read as want to.

## Numbers and names spot check

| Item (reference) | Deepgram nova-3 | AAI u3-pro | AAI u3.5-pro |
|---|---|---|---|
| Perot: "$4 trillion debt" | "$4,000,000,000,000 debt" (right value, awkward format) | "$4 trillion debt" | "$4 trillion debt" |
| "5 and a half million people" | "five and a half million" | "5.5 million" | "5.5 million" |
| "90-minute event" | "ninety minute" (a 4-min probe run heard "ninety eight") | "90-minute" | "90-minute" |
| "$52,000", "$60,000", "35,000 jobs", "50,000 other Americans" | all right | all right | all right |
| "first to thirteenth in wages", "last twelve years" | right (spelled out) | "13th", "12 years" | "1st to 13th" |
| Russia "1969-70" | "1969, 1970" | "1969, 1970" | (same) |
| Jim **Lehrer** / **MacNeil-Lehrer** | "Jim Lara", "McNeil Lara" (wrong) | right | right |
| **Perot** | "Perrault" 3 times, "Perot" 3 times | "Perot" every time | "Perot" |
| John Mashek / Sander Vanocur | "Maschick" / "Sandra Van Ocher" | "Masic" / "Sandra Vanocur" | "Masic" / "Sandra Van Ocker" |

Every service got every numeric claim right. The real difference is names. Deepgram got the moderator and a candidate wrong, and that matters for CONTXT, because claims get grouped and researched by who said them and who they're about. Deepgram's number formatting is also inconsistent: some numbers come out as digits and some spelled out.

## Recommendation

**Make AssemblyAI the default for pre-recorded audio.**
- It had the lowest WER (3.2% against 4.2%), got the names right and formatted numbers cleanly. Its diarization is as good as Deepgram's and it costs slightly less per hour. Speed doesn't settle it: AssemblyAI was faster when we sent WAV, and Deepgram was faster with Opus (5.3 s against 12.4 s). Either is fine for recordings.
- Pin `speech_models` explicitly. The pricing page warns that defaults change between the free tier and paid accounts.
- universal-3-pro scored a little better than universal-3-5-pro here. Most of 3.5-pro's extra "errors" are inserted words, likely verbatim repeats that the edited reference leaves out. Use `universal-3-5-pro` as the long-term default because it's the current, priced model, and re-check once we have a verbatim test clip.
- Keep Deepgram as the second adapter and for the later live-listening step, where its streaming is strong. If we use Deepgram, turn on keyterm prompting with the speakers' names (+$0.0013/min).

## Credit used (estimated)

Neither key can read its account balance. The Deepgram key lacks the `billing:read` and `usage:read` scopes, and AssemblyAI has no balance API. These figures come from billed durations and list prices.

- **Deepgram:** 4 full-clip runs plus 2 short probes (4 min and 2.5 min, used to find the start and end), about 69 min in total, so about **$0.30 of the $200**.
- **AssemblyAI:** 3 full-clip runs, about 0.78 hr in total, so about **$0.18 of the $50**.

## Files in this repo

- `samples/audio/debate1992.opus`: the clip (3.6 MB, 32 kbps Opus, 16 kHz mono). Rebuild it, or get the WAV, with `scripts/fetch_debate1992.sh`.
- `samples/debate1992.clip.json`: the span, source URLs and public-domain note.
- `samples/debate1992.reference.json`: the debates.org reference turns for the span, built with `bakeoff/build_ref.py`.
- `samples/debate1992.json`: the harness fixture. It's AssemblyAI universal-3-pro output with 177 sentence segments and 5 named speakers.
- `bakeoff/raw/*.json`: the raw provider responses that were scored. The AssemblyAI upload URL is redacted.
- `bakeoff/score.py`, `bakeoff/to_fixture.py` and `bakeoff/run_bakeoff.sh`: the scoring, fixture conversion and full re-run scripts.
- `bakeoff/scores.json`: the scoring output.
- `bakeoff/transcripts/*.json`: one named-speaker fixture per provider.

## Adapter check (added with the PR)

I ran the new TypeScript adapters (`npm run transcribe`) once more, this time on the committed Opus file:

| Run | WER | Speakers | Words given to the right speaker | Wall-clock time |
|---|---|---|---|---|
| AssemblyAI universal-3-5-pro (default) | 3.96% | 5 | 99.85% | 12.4 s |
| Deepgram nova-3, keyterms Perot, Lehrer, MacNeil | 4.25% | 5 | 99.81% | 5.3 s |

Keyterms fixed Deepgram's names: "Jim Lehrer" and "Perot" came out right, with no "Perrault". Sending Opus instead of WAV cut Deepgram's time from 30.6 s to 5.3 s, so most of that earlier time was upload.

## Notes and caveats

- Speaker names in the fixture come from aligning the provider labels with the reference transcript. In real use, CONTXT will need its own naming step, such as matching self-introductions or a moderator cue list.
- The harness now carries `speaker` from segments to claims. Claims are written to `out/<run>/claims.json`, the deck shows who said each claim, and the scorecard counts claims per speaker.
- Deepgram spells out some numbers ("twelve years"), so the heuristic claim filter, which wants a digit or a cue word, keeps fewer of its sentences. That's 61 claims through the Deepgram adapter against 87 from the AssemblyAI fixture.
- Each segment is one sentence, so the claim extractor sees sentences rather than whole two-minute answers.
- The Wikimedia source has about 2 minutes of pre-air audio. Any later clip should keep the 126 s offset (stored in `meta.clipStartInSourceMs`).
