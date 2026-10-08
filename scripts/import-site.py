#!/usr/bin/env python3
"""Turn the FITRON website design export into the static home page in public/site.

Usage: python3 scripts/import-site.py "path/to/FITRON Website.html"

The design tool exports one self-unpacking HTML file (React runtime, fonts and images inside).
This unpacks it, keeps only the rendered page, and rewires its buttons to the real app:
trial buttons to /signup?plan=..., "Open Gym Accounting" to /login, policies to /privacy, /terms, /refund.
If the design changes those buttons, the asserts below fail: update the mapping here.
Our own edits on top of the design (wording that must match the product, structured data, the phone menu
fix) are in scripts/site_patches.py and are applied last. This script deletes and rebuilds public/site, so
afterwards run `node scripts/optimise-site-images.mjs` to turn the PNG screenshots back into WebP.
public/site/og.png (the share image) is a screenshot and is not touched.
"""
import re, os, sys, json, base64, gzip, mimetypes, shutil, tempfile

src = sys.argv[1]
out = tempfile.mkdtemp()
S = out
O = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "site")
os.makedirs(out,exist_ok=True)
s=open(src,encoding="utf-8").read()
def get(t):
    m=re.search(r'<script type="__bundler/%s">(.*?)</script>'%t,s,re.S); return json.loads(m.group(1))
man=get("manifest"); tpl=get("template"); ext=get("ext_resources")
names={}
for u,e in man.items():
    d=base64.b64decode(e["data"])
    if e.get("compressed"): d=gzip.decompress(d)
    x=mimetypes.guess_extension(e["mime"]) or ".bin"
    fn=u+x; open(os.path.join(out,fn),"wb").write(d); names[u]=fn
for u,fn in names.items(): tpl=tpl.replace(u,fn)
open(os.path.join(out,"index.html"),"w").write(tpl)

og=open(O+'/og.png','rb').read() if os.path.exists(O+'/og.png') else None
shutil.rmtree(O,ignore_errors=True); os.makedirs(O+'/fonts')
if og: open(O+'/og.png','wb').write(og)
s=open(S+'/index.html',encoding='utf-8').read()
names={'640aeaa0-46f6-4559-a6f5-e1a6171ab2ab.png':'/site/fitron-ring.png',
 '94dc4898-fefe-4fff-ae90-7cda15d00534.png':'/site/console-dashboard.png',
 '2e24de66-4acd-4e44-9826-3da95f1a6402.png':'/site/app-dashboard.png',
 'ec23c9cb-d303-4ae4-ab6f-572f625c0e3f.png':'/fitron-mark.png'}
for f in os.listdir(S):
    if f.endswith('.woff2'): names[f]='/site/fonts/'+f
for k,v in names.items():
    if v.startswith('/site/'): shutil.copy(S+'/'+k, O+v[5:])
    s=s.replace(k,v)
shutil.copy(S+'/12d3a4b8-6bd7-472b-8e6b-4a75def47723.js',O+'/fitron-page.js')
shutil.copy(S+'/c7b4d7a1-1e15-4f62-8f35-db52608414ad.js',O+'/three.module.js')
d3=open(S+'/065d269a-9c47-4b80-a1da-7c482996a803.js').read().replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js','/site/three.module.js')
open(O+'/fitron-3d.js','w').write(d3)
helmet=re.search(r'<helmet>(.*?)</helmet>',s,re.S).group(1)
body=re.search(r'</helmet>(.*?)</x-dc>',s,re.S).group(1)
body=body.replace('sc-camel-view-box','viewBox').replace('sc-camel-gradient-units','gradientUnits')
helmet=helmet.replace('sc-camel-view-box','viewBox')
# links into the real app
WA_AI='href="https://wa.me/916207774673?text=Hi%20FITRON%2C%20I%20want%20to%20start%20my%207-day%20free%20trial%20of%20AI%20Trainer." target="_blank"'
WA_PARTNER='href="https://wa.me/916207774673?text=Hi%20FITRON%2C%20I%20run%20a%20gym%20and%20want%20to%20talk%20about%20a%20partnership." target="_blank" rel="noopener"'
APP='href="gym-accounting/Fitron Gym.dc.html" target="_blank"'
body=body.replace(APP+'>Open Gym Accounting','href="/login">Open Gym Accounting')
# pricing cards, in page order
cards=['ai-pro','ai-premium','starter','professional','enterprise','partner-referral','partner-software',None]
parts=re.split(r'(<article class="pc[ "].*?</article>)',body,flags=re.S)
i=0
for j,part in enumerate(parts):
    if part.startswith('<article class="pc'):
        k=cards[i]; i+=1
        dest='href="/signup?plan=%s"'%k if k else 'href="/contact?topic=partner"'
        part,n=re.subn(re.escape(WA_AI)+'|'+re.escape(WA_PARTNER)+'|'+re.escape(APP),dest,part); assert n==1,(k,n)
        parts[j]=part
assert i==len(cards),i
body=''.join(parts)
# product cards and the closing call to action
body=body.replace(WA_AI,'href="/signup?plan=ai-pro"')
body=body.replace(APP,'href="/signup?plan=professional"')
body=body.replace('href="mailto:hello@fitron.in?subject=FITRON%20Sales"','href="/contact?topic=sales"')
legal={'privacy':'/privacy','cookies':'/privacy#cookies','rights':'/privacy#rights','grievance':'/privacy#grievance','terms':'/terms','partners':'/terms#partners'}
body=re.sub(r'href="Legal\.dc\.html#([a-z]+)"( data-fallback="#[a-z]+")?',lambda m:'href="%s"'%legal[m.group(1)],body)
body=body.replace('<a href="#faq">Read the policies.</a>','<a href="/privacy">Read the policies.</a>')
body=body.replace('<li><a href="#faq">FAQ</a></li>\n  </ul>','<li><a href="#faq">FAQ</a></li>\n    <li><a href="/signin">Log in</a></li>\n  </ul>',1)
body=body.replace('<a href="#faq">FAQ</a>\n  <a class="btn btn-gold" href="#products">','<a href="#faq">FAQ</a><a href="/signin">Log in</a>\n  <a class="btn btn-gold" href="#products">',1)
# "Log in" opens the sign-in chooser (gym console or AI Trainer); only "Open Gym Accounting" goes straight to the console.
assert body.count('href="/signin"')==2 and body.count('href="/login"')==1
body=body.replace('<li><a href="#together">Better together</a></li>\n    <li><a href="#partnership">','<li class="nav-extra"><a href="#together">Better together</a></li>\n    <li><a href="#partnership">',1)
assert 'nav-extra' in body
body=body.replace('<li><a href="/terms">Terms &amp; Conditions</a></li>','<li><a href="/terms">Terms &amp; Conditions</a></li>\n    <li><a href="/refund">Refund Policy</a></li>\n    <li><a href="/contact">Contact us</a></li>',1)
body=body.replace('<a href="mailto:hello@fitron.in">hello@fitron.in</a><span>','<a href="mailto:hello@fitron.in">hello@fitron.in</a><a href="/contact">Send us a message</a><span>',1)
assert '/refund' in body and 'Send us a message' in body
body=body.replace(' data-fallback="#products"','')
assert 'data-fallback' not in body
# Only the dashboard screenshot shipped with the design; the Workouts and Nutrition tabs come back with the trainer app.
body,n=re.subn(r'\s*<div class="gallery-thumbs">.*?</div>','',body,flags=re.S); assert n==1
assert 'gym-accounting/' not in body and 'Legal.dc' not in body and '.dc.html' not in body, re.findall(r'.{60}\.dc\.html.{20}',body)
boot='''<script type="module">
import('/site/fitron-page.js').then((m) => m.init()).catch((e) => console.error('[FITRON] page init failed', e));
import('/site/fitron-3d.js').then((m) => m.start(document.getElementById('scene'))).catch((e) => console.warn('[FITRON] 3D logo unavailable, showing the flat logo', e));
</script>'''
out='<!DOCTYPE html>\n<html lang="en-IN">\n<head>\n<meta charset="utf-8">'+helmet+'</head>\n<body>'+body+boot+'\n</body>\n</html>\n'
SEO='''<link rel="canonical" href="https://fitron.in/">
<link rel="apple-touch-icon" href="/fitron-mark.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FITRON">
<meta property="og:url" content="https://fitron.in/">
<meta property="og:title" content="FITRON: your AI trainer, and your gym's accounts">
<meta property="og:description" content="An AI personal trainer for ₹299 a month. Gym accounting software from ₹999 a month. 7-day free trial on both.">
<meta property="og:image" content="https://fitron.in/site/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
'''
out=out.replace('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">\n',SEO)
assert 'og:image' in out
# The added "Log in" item makes the desktop nav one item longer than the design; tighten it on narrower desktops.
out=out.replace('</style>','.nav .brand,.nav .nav-cta{flex-shrink:0}@media (max-width:1400px){.nav-links{gap:clamp(10px,1.4vw,22px)}.nav-links a{letter-spacing:.08em}.nav-links .nav-extra{display:none}}\n</style>',1)
out=out.replace('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">','<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="description" content="FITRON: an AI personal trainer for ₹299 a month, and gym accounting software with GST invoices, WhatsApp reminders and P&amp;L from ₹999 a month.">',1)
# Everything we change on top of the design (wording that must match the product, structured data, the phone menu fix...).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import site_patches
out=site_patches.apply(out)
open(O+'/index.html','w',encoding='utf-8').write(out)
print('Wrote', O, len(out), 'bytes. Now: node scripts/optimise-site-images.mjs (PNG screenshots to WebP), then check the page and run npm test (pricing.test.ts and site-links.test.ts check prices, links and structured data).')
