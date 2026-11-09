"""Turn raw provider responses into named-speaker harness fixtures.

Usage: python3 bakeoff/to_fixture.py  (after bakeoff/score.py)
Speaker labels are mapped to names using the alignment in bakeoff/scores.json.
Writes bakeoff/transcripts/<run>.json; samples/debate1992.json is the AssemblyAI universal-3-pro one.
"""
import os
import json,re
NAMES={'LEHRER':'Jim Lehrer (moderator)','PEROT':'Ross Perot','CLINTON':'Bill Clinton','BUSH':'George H. W. Bush','COMPTON':'Ann Compton (panelist)'}
sc={r['provider']:r for r in json.load(open('bakeoff/scores.json'))['results']}
def words_dg(d):
    return [(w['punctuated_word'],f"S{w['speaker']}",round(w['start']*1000),round(w['end']*1000),w.get('speaker_confidence')) for w in d['results']['channels'][0]['alternatives'][0]['words']]
def words_aai(d):
    return [(w['text'],w['speaker'],w['start'],w['end'],w.get('confidence')) for w in d['words']]
def build(words,mapping,provider,model,raw):
    segs=[];cur=[]
    def flush():
        if cur:
            segs.append({'startMs':cur[0][2],'endMs':cur[-1][3],'speaker':mapping.get(cur[0][1],cur[0][1]),'speakerLabel':cur[0][1],'text':' '.join(w[0] for w in cur)})
            cur.clear()
    for w in words:
        if cur and w[1]!=cur[-1][1]: flush()
        cur.append(w)
        if re.search(r'[.?!]["”]?$',w[0]) and len(cur)>=4: flush()
    flush()
    spk={}
    for s in segs:
        x=spk.setdefault(s['speaker'],{'id':s['speaker'],'name':NAMES.get(s['speaker'],s['speaker']),'providerLabel':s['speakerLabel'],'segments':0,'talkMs':0})
        x['segments']+=1;x['talkMs']+=s['endMs']-s['startMs']
    return {'meta':{'title':'First 1992 presidential debate (Bush, Clinton, Perot), opening 15:35',
        'source':'https://commons.wikimedia.org/wiki/File:Presidential_Debate_with_George_H._W._Bush,_Bill_Clinton_and_Ross_Perot_11_October_1992.webm',
        'license':'Public domain','date':'1992-10-11','clipStartInSourceMs':126000,'clipEndInSourceMs':1061400,
        'durationMs':935400,'provider':provider,'model':model,'rawFile':raw,
        'speakerNames':'Provider labels mapped to names by aligning with the debates.org transcript',
        'reference':'https://www.debates.org/voter-education/debate-transcripts/october-11-1992-first-half-debate-transcript/'},
        'speakers':list(spk.values()),'segments':segs}
dg=json.load(open('bakeoff/raw/deepgram_nova3.json'))
outs={'deepgram_nova3':build(words_dg(dg),sc['Deepgram nova-3']['mapping'],'deepgram','nova-3','bakeoff/raw/deepgram_nova3.json')}
for k,f,n,m in [('assemblyai_u3pro','bakeoff/raw/assemblyai_u3pro.json','AssemblyAI universal-3-pro','universal-3-pro'),('assemblyai_u35pro','bakeoff/raw/assemblyai_u35pro.json','AssemblyAI universal-3-5-pro','universal-3-5-pro')]:
    outs[k]=build(words_aai(json.load(open(f))),sc[n]['mapping'],'assemblyai',m,f)
os.makedirs('bakeoff/transcripts',exist_ok=True)
for k,v in outs.items():
    json.dump(v,open(f'bakeoff/transcripts/{k}.json','w'),indent=1,ensure_ascii=False)
    print(k,len(v['segments']),[ (s['id'],s['segments']) for s in v['speakers']])
