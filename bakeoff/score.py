"""Score provider transcripts against the debates.org reference.

Usage: python3 bakeoff/score.py [name=raw.json ...]
Default runs are the three committed raw responses in bakeoff/raw/.
Writes bakeoff/scores.json. Needs: pip install -r bakeoff/requirements.txt
"""
import sys
import json,re,difflib
from collections import Counter,defaultdict
import jiwer
from num2words import num2words

REPL={"mr.":"mister","mrs.":"missus","dr.":"doctor","st.":"saint","wanna":"want to","gonna":"going to","gotta":"got to","ok":"okay","%":" percent"}
def num_words(m):
    s=m.group(0).replace(',','')
    try:
        if '.' in s: return ' '+num2words(float(s))+' '
        return ' '+num2words(int(s))+' '
    except Exception: return ' '+s+' '
def norm_text(s):
    s=s.lower().replace('’',"'").replace('‘',"'").replace('–',' ').replace('—',' ').replace('-',' ')
    for k,v in REPL.items(): s=s.replace(k,v)
    s=re.sub(r"\b(\d+)s\b",lambda m:m.group(1)+' s_',s)  # 70s
    s=re.sub(r"\$(\d[\d,]*(?:\.\d+)?)\s*(million|billion|trillion)?",lambda m:' '+m.group(1)+' '+(m.group(2) or '')+' dollars ',s)
    s=re.sub(r"\b(\d+)(st|nd|rd|th)\b",lambda m:' '+num2words(int(m.group(1)),to='ordinal')+' ',s)
    s=re.sub(r"\b(\d+)\.5 (million|billion|trillion)",lambda m:m.group(1)+' and a half '+m.group(2),s)
    s=re.sub(r"\d[\d,]*(?:\.\d+)?",num_words,s)
    s=s.replace(' s_','s')
    s=re.sub(r"[^a-z' ]"," ",s.replace('-',' '))
    s=re.sub(r"(?<!\w)'|'(?!\w)"," ",s)
    return s.split()
def norm_word(w): return norm_text(w)

ref=json.load(open('samples/debate1992.reference.json'))
ref_words=[];ref_spk=[]
for t in ref:
    ws=norm_text(t['text']); ref_words+=ws; ref_spk+=[t['speaker']]*len(ws)

def load_dg(p):
    d=json.load(open(p)); out=[]
    for w in d['results']['channels'][0]['alternatives'][0]['words']:
        for x in norm_text(w['punctuated_word']): out.append((x,f"S{w['speaker']}",w['start'],w['end']))
    return out,d
def load_aai(p):
    d=json.load(open(p)); out=[]
    for w in d['words']:
        for x in norm_text(w['text']): out.append((x,w['speaker'],w['start']/1000,w['end']/1000))
    return out,d

def score(name,hw,turns):
    hyp=[x[0] for x in hw]
    o=jiwer.process_words(' '.join(ref_words),' '.join(hyp))
    # alignment for speaker
    sm=difflib.SequenceMatcher(None,ref_words,hyp,autojunk=False)
    pairs=[]
    for a,b,n in sm.get_matching_blocks():
        for i in range(n): pairs.append((ref_spk[a+i],hw[b+i][1]))
    co=defaultdict(Counter)
    for r,h in pairs: co[h][r]+=1
    mapping={h:c.most_common(1)[0][0] for h,c in co.items()}
    correct=sum(1 for r,h in pairs if mapping[h]==r)
    # hyp turns
    ht=[];prev=None
    for w in hw:
        if w[1]!=prev: ht.append(w[1]); prev=w[1]
    return dict(provider=name,wer=o.wer,sub=o.substitutions,dele=o.deletions,ins=o.insertions,ref_words=len(ref_words),hyp_words=len(hyp),
        speakers_found=len(set(x[1] for x in hw)),mapping=mapping,mapping_detail={h:dict(c) for h,c in co.items()},
        speaker_word_acc=correct/len(pairs),aligned_words=len(pairs),hyp_turns=len(ht),ref_turns=len(ref),
        hyp_turn_seq=[mapping.get(x,x) for x in ht])


DEFAULT=[('Deepgram nova-3','bakeoff/raw/deepgram_nova3.json'),
      ('AssemblyAI universal-3-pro','bakeoff/raw/assemblyai_u3pro.json'),
      ('AssemblyAI universal-3-5-pro','bakeoff/raw/assemblyai_u35pro.json')]
pairs=[tuple(a.split('=',1)) for a in sys.argv[1:]] or DEFAULT
def load_any(p):
    d=json.load(open(p))
    return (load_dg if 'results' in d else load_aai)(p)[0]
runs=[(n,load_any(p)) for n,p in pairs]
res=[score(n,w,None) for n,w in runs]
seq=[t['speaker'] for t in ref]
for r in res: r['turn_seq_similarity']=difflib.SequenceMatcher(None,seq,r['hyp_turn_seq']).ratio()
json.dump({'ref_turn_seq':seq,'results':res},open('bakeoff/scores.json','w'),indent=1)
for r in res: print(r['provider'],f"WER {r['wer']*100:.2f}% S{r['sub']} D{r['dele']} I{r['ins']} speakers {r['speakers_found']} speaker-word-acc {r['speaker_word_acc']*100:.2f}% turns {r['hyp_turns']}/{r['ref_turns']} turn-order {r['turn_seq_similarity']:.2f}", r['mapping'])
