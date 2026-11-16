import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
ok=True
for k in a:
    if a[k]!=b.get(k):
        ok=False
        print(f"  DIFF {k}")
        if isinstance(a[k],list):
            sa,sb=set(a[k]),set(b[k]); 
            for x in list(sa-sb)[:3]: print("   - before:",x[:300])
            for x in list(sb-sa)[:3]: print("   + after: ",x[:300])
        else: print("   ",a[k],"→",b.get(k))
counts={k:len(v) for k,v in a.items() if isinstance(v,list)}
print(("IDENTICAL " if ok else "DIFFERENT ")+sys.argv[1].split('/')[-1]+" vs "+sys.argv[2].split('/')[-1]+"  rows: "+", ".join(f"{k}={v}" for k,v in counts.items()))
sys.exit(0 if ok else 1)
