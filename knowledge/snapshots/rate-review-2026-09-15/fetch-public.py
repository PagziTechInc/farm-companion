import json,time,hashlib,datetime,pathlib,concurrent.futures,urllib.request,re
base=pathlib.Path('.local-deploy/rate-review-2026-09-15')
fresh=str(int(time.time()*1000))
urls={
 'almanac.html':'https://rh.farm/almanac/',
 'provenance.html':'https://rh.farm/provenance/',
 'home.html':'https://rh.farm/',
 'api-stats.json':'https://api.rh.farm/stats?fresh='+fresh,
 'api-weather.json':'https://api.rh.farm/weather?fresh='+fresh,
 'api-plot-1.json':'https://api.rh.farm/plot/1?fresh='+fresh,
 'api-plot-346.json':'https://api.rh.farm/plot/346?fresh='+fresh,
 'api-metadata-1.json':'https://api.rh.farm/metadata/1?fresh='+fresh,
 'api-metadata-346.json':'https://api.rh.farm/metadata/346?fresh='+fresh,
 'host-collector-status.json':'https://farm.pagzi.tech/collection/status.json?fresh='+fresh,
}
def get(item):
 name,url=item; now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'YieldFarmCompanion-SourceReview/1.0','Cache-Control':'no-cache'})
  with urllib.request.urlopen(req,timeout=30) as r:
   data=r.read(4000000)
   result={'file':name,'url':url,'observed_at_utc':now,'response_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':r.status,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'headers':dict(r.headers)}
  (base/name).write_bytes(data)
  if name.endswith('.html'):
   result['contract_urls']=sorted(set(re.findall(r'https://[^\s\"<>]*(?:0x[0-9a-fA-F]{40})[^\s\"<>]*',data.decode())))
  else: result['json']=json.loads(data)
  return result
 except Exception as e:return {'file':name,'url':url,'observed_at_utc':now,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex: results=list(ex.map(get,urls.items()))
(base/'fetches.json').write_text(json.dumps(results,indent=2))
for r in results:
 r.pop('headers',None)
 print(json.dumps(r))
