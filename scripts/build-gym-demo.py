#!/usr/bin/env python3
"""Builds public/site/gym-demo.html, the Gym Accounting live demo on the website, from the prototype in prototype/.

    python3 scripts/build-gym-demo.py

The demo is a self-unpacking export of prototype/Fitron Gym.dc.html: the design tool's runtime, React, the design system,
fonts and pictures, all inside one file. This script keeps that shell (the runtime, React, fonts and pictures in the
current public/site/gym-demo.html) and puts the prototype's current code and screens into it:

  1. fitron-core.js, fitron-app.js and fitron-views.js are replaced with the files in prototype/.
  2. The screens (everything in Fitron Gym.dc.html after the fitron-views.js script) are replaced, rewritten the way the
     export writes them: camelCase attributes become sc-camel-… ones, tables and selects become sc-raw-… elements, and the
     three pictures in prototype/assets point at the copies already in the file.
  3. Fitron AI and the bill reader use the real AI. In the design tool the prototype calls window.claude.complete, which
     only exists there, so on fitron.in it fell back to its keyword replies and the bill reader did nothing. The demo now
     brings its own window.claude.complete, which asks /api/gym-demo/ai (src/app/api/gym-demo/ai/route.ts), the open,
     rate-limited endpoint for this demo. Without an answer from it the prototype uses its built-in replies as before.

Running it again is safe: every part it changes is replaced whole. Every edit asserts that it applies, so a prototype
that changes the text we look for stops with a message instead of being published half-patched.
"""
import base64
import gzip
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "site", "gym-demo.html")
PROTO = os.path.join(ROOT, "prototype")

# The export's ids for the files this script replaces, and the prototype file each one is.
SCRIPTS = {
    "a819a434-1149-4258-bd83-0c443778190b": "fitron-core.js",
    "e196faa5-98bf-4b24-97c1-410aafeb15b2": "fitron-app.js",
    "fd32c32f-5155-463b-8ef3-47dc694ce5e3": "fitron-views.js",
}
# The prototype's pictures, and the ids of the same pictures in the export.
ASSETS = {
    "assets/fitron-logo-transparent.png": "1f1b9dcf-8e74-4e56-971a-332fbdc994aa",
    "assets/fitron-mark.png": "64075543-466b-40bf-b3e8-0e8a676f82f2",
    "assets/fitron-logo.png": "a81d736f-127c-4745-9412-e2107c186c8f",
}
VIEWS_TAG = '<script src="fitron-views.js"></script>'
# Elements the export renames so the browser's HTML parser can't move them around before the runtime sees them.
RAW = ("select", "table", "tbody", "thead", "tr", "td", "th")

# window.claude.complete for fitron.in, in front of fitron-app.js. It takes what the prototype passes (system, messages,
# tools with their own run functions, max_tokens) and returns the reply's text, as in the design tool. Tool calls are run
# here, in the visitor's browser, by the prototype's own run functions against the demo data, and their results are sent
# back until the model answers. The server picks the prompt, the tools and the model: only the conversation goes up.
# Any failure throws, and the prototype then answers with its built-in replies.
SHIM = r"""// window.claude.complete for the website demo (scripts/build-gym-demo.py): asks /api/gym-demo/ai.
(function(){if(window.claude&&window.claude.complete)return;
const post=async body=>{const r=await fetch('/api/gym-demo/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j};
const textOf=content=>(content||[]).filter(b=>b&&b.type==='text').map(b=>b.text).join('').trim();
window.claude={complete:async req=>{
 const msgs=(req.messages||[]).map(m=>({role:m.role,content:m.content}));
 const tools=req.tools||[];
 if(!tools.length){const j=await post({mode:'bill',messages:msgs});return j.text||''}
 const ctx=window.__fitronDemoCtx||{};
 for(let round=0;round<6;round++){
  const j=await post({mode:'chat',context:ctx,messages:msgs});
  const uses=(j.content||[]).filter(b=>b&&b.type==='tool_use');
  if(j.stop_reason!=='tool_use'||!uses.length){const t=textOf(j.content);if(!t)throw new Error('empty reply');return t}
  msgs.push({role:'assistant',content:j.content});
  const results=[];
  for(const u of uses){const tool=tools.find(t=>t.name===u.name);let out;
   try{out=tool?await tool.run(u.input||{}):'Unknown tool.'}catch(e){out='The tool failed: '+(e&&e.message||e)}
   results.push({type:'tool_result',tool_use_id:u.id,content:String(out==null?'':out).slice(0,20000)})}
  msgs.push({role:'user',content:results})}
 throw new Error('too many steps')}};
})();
"""


def once(text, old, new, why):
    assert text.count(old) == 1, f"{why}: expected one match, found {text.count(old)}"
    return text.replace(old, new)


def kebab(name):
    return re.sub(r"([A-Z])", lambda m: "-" + m.group(1).lower(), name)


def export_screens(html):
    """The prototype's screens written the way the design tool's export writes them."""

    def attrs(tag):
        return re.sub(r"(\s)([a-z]+[A-Z][A-Za-z]*)(=)", lambda m: m.group(1) + "sc-camel-" + kebab(m.group(2)) + m.group(3), tag)

    html = re.sub(r"<[a-zA-Z][^<>]*>", lambda m: attrs(m.group(0)), html)
    for t in RAW:
        html = re.sub(r"<(/?)%s(?=[\s>])" % t, r"<\1sc-raw-%s" % t, html)
    for path, key in ASSETS.items():
        html = html.replace(path, key)
    left = sorted(set(re.findall(r"""["'(]assets/[^"')]+""", html)))
    assert not left, f"pictures the export does not have: {left}"
    return html


def patch_app(js):
    """fitron-app.js for the website. The AI prompt also tells the shim who is asking, for the server's prompt."""
    js = once(
        js,
        "let reply;try{if(!window.claude||!window.claude.complete)throw new Error('offline');",
        "window.__fitronDemoCtx={gym:s0.settings.gym.name,city:[s0.settings.gym.address,s0.settings.gym.city].filter(Boolean).join(', '),today:TODAY,user:A.user(s0),role:s0.role,finance:!!fin};"
        "let reply;try{if(!window.claude||!window.claude.complete)throw new Error('offline');",
        "Fitron AI call",
    )
    return SHIM + js


def pack(data):
    return {"mime": "application/javascript", "compressed": True, "data": base64.b64encode(gzip.compress(data.encode("utf-8"), mtime=0)).decode()}


def main():
    src = open(OUT, encoding="utf-8").read()

    def tag(name):
        m = re.search(r'(<script type="__bundler/%s"[^>]*>)(.*?)(</script>)' % name, src, re.S)
        assert m, f"the demo has no {name}"
        return m

    man, tpl = tag("manifest"), tag("template")
    manifest = json.loads(man.group(2))
    template = json.loads(tpl.group(2))

    for key, name in SCRIPTS.items():
        assert key in manifest, f"{name}: {key} is not in the demo"
        code = open(os.path.join(PROTO, name), encoding="utf-8").read()
        if name == "fitron-app.js":
            code = patch_app(code)
        manifest[key] = pack(code)

    page = open(os.path.join(PROTO, "Fitron Gym.dc.html"), encoding="utf-8").read()
    assert page.count(VIEWS_TAG) == 1, "Fitron Gym.dc.html: the fitron-views.js script is not there once"
    screens = export_screens(page.split(VIEWS_TAG, 1)[1])
    views_key = next(k for k, v in SCRIPTS.items() if v == "fitron-views.js")
    views = f'<script src="{views_key}"></script>'
    assert template.count(views) == 1, "the demo's template does not load fitron-views.js once"
    template = template.split(views, 1)[0] + views + screens

    def blob(obj):
        # inside a <script>, so "</" must not appear
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    out = src
    # replace the later one first so the earlier offsets stay valid
    for m, obj in sorted(((tpl, template), (man, manifest)), key=lambda x: -x[0].start(2)):
        out = out[: m.start(2)] + blob(obj) + out[m.end(2) :]
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(out) / 1e6:.1f} MB ({len(manifest)} files)")


if __name__ == "__main__":
    if len(sys.argv) != 1:
        sys.exit(__doc__)
    main()
