"""Cut the debates.org reference transcript to the clip span.

Usage: python3 bakeoff/build_ref.py  (writes samples/debate1992.reference.json)
"""
import html, json, re, sys, urllib.request
from collections import Counter

URL = "https://www.debates.org/voter-education/debate-transcripts/october-11-1992-first-half-debate-transcript/"
START = "LEHRER: Good evening"
END = "and that’s what I want to do."  # last words of Clinton's answer at the clip end
OUT = sys.argv[1] if len(sys.argv) > 1 else "samples/debate1992.reference.json"

raw = urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})).read().decode("utf-8", "ignore")
t = re.sub(r"<script.*?</script>|<style.*?</style>", "", raw, flags=re.S)
t = re.sub(r"<br\s*/?>|</p>", "\n", t)
t = html.unescape(re.sub(r"<[^>]+>", "", t)).replace("Â", "").replace("\xa0", " ")
s = t.find(START)
e = t.find(END, s + 15000) + len(END)
turns = []
for para in [p.strip() for p in t[s:e].split("\n") if p.strip()]:
    m = re.match(r"^([A-Z][A-Z .]+):\s*(.*)$", para)
    if m:
        turns.append({"speaker": m.group(1).replace("PRESIDENT ", "").strip(), "text": m.group(2)})
    else:
        turns[-1]["text"] += " " + para
for x in turns:
    x["text"] = re.sub(r"\s*\(Inaudible\)\.?", "", x["text"]).strip()
    x["text"] = re.sub(r"\s+ANN$", "", x["text"])
turns = [x for x in turns if x["text"]]
json.dump(turns, open(OUT, "w"), indent=1, ensure_ascii=False)
print(len(turns), "turns", Counter(x["speaker"] for x in turns), sum(len(x["text"].split()) for x in turns), "words")
