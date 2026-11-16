import json,sys
t=open(sys.argv[1]).read(); j=json.loads(t[t.index('{\n'):t.rindex('}')+1])
print(sys.argv[1].split('/')[-1][:-4].ljust(22), j['status'][:8], 'inv',str(j['invoices_created']).rjust(3),'total',str(j['total_ms']).rjust(6),'ms  gen',str(j['generate_ms']).rjust(6),'reqs',str(j['total_requests']).rjust(4), ' | '+'  '.join(f"{p['phase']}={p['ms']}ms/{p['requests']}r" for p in j['phases']))
