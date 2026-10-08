#!/usr/bin/env python3
"""Builds public/site/coach-demo.html, the AI Coach live demo on the home page, from the design export of the
AI Trainer app prototype (the single-file "Fitron App" bundle).

    python3 scripts/build-coach-demo.py path/to/Fitron_App.html

The export is the whole member app with fake data. The demo is that app, opened on its Coach screen as a made-up member
(the persona below), with three changes so that it can live on fitron.in:

  1. The coach asks /api/coach/demo (src/app/api/coach/demo/route.ts), the open, rate-limited twin of /api/coach, instead
     of /api/coach, which needs a signed-in member. Without an answer from it the app uses its built-in replies.
  2. Everything it keeps in localStorage gets a "fitron-demo." name, because the real AI Trainer app (public/trainer)
     runs on the same origin and uses "fitron.chats", "fitron.avatar" and so on. Nothing in the demo may reach those.
  3. It opens signed in on the Coach screen (or the screen named after "#" in its address), as the persona, instead of on
     the sign-in page.

It is also made smaller: the icon font ships as woff2 only (not also woff, ttf and svg) and three large PNGs become WebP,
which takes the file from 8 MB to about 3 MB. The meal and theme pictures are not in the file: they are the ones in
public/trainer/assets, which the AI Trainer app serves. Every edit asserts that it applies, so a new export that changes
the text we look for stops with a message instead of being published half-patched.
"""
import base64
import gzip
import io
import json
import os
import re
import sys

from PIL import Image

PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
OUT = os.path.join(PUBLIC, "site", "coach-demo.html")

# The member the demo is signed in as. Values are the app's own onboarding answers, so every target and plan it works out
# (calories, protein, schedule, today's session) follows from them.
PERSONA = [
    ("name:'', age:'', sex:'', height:'', weight:'',", "name:'Rohan', age:'28', sex:'Male', height:'174', weight:'74',"),
    ("goal:'', extras:[],", "goal:'Build muscle', extras:['Better sleep'],"),
    ("trainNow:'', dayLike:'', injuries:[], injuryNote:'',", "trainNow:'3–4 days a week', dayLike:'I sit most of the day', injuries:['Nothing'], injuryNote:'',"),
    ("days:[], timeOfDay:'', exactTime:'', session:'', wake:'06:30', sleep:'23:00',", "days:['Mon','Tue','Wed','Thu','Fri','Sat'], timeOfDay:'Evening', exactTime:'18:30', session:'45 min', wake:'06:30', sleep:'23:00',"),
    ("equipment:[], gymName:'Power Haus Gym',", "equipment:['Full gym'], gymName:'Power Haus Gym',"),
    ("diet:'', cuisines:[], avoid:[], mealsDay:'', cooks:'',", "diet:'Non-veg', cuisines:['North Indian'], avoid:['None'], mealsDay:'4 meals', cooks:'Cooked at home',"),
    ("state:'', city:'', budget:'',", "state:'Maharashtra', city:'Pune', budget:'₹6,000 – ₹10,000',"),
]

# The screens the demo can be opened on (coach-demo.html#workout); anything else opens the Coach.
SCREENS = ["home", "planner", "workout", "food", "progress", "habits", "coach", "review", "profile", "settings", "subscription", "onboard", "pickTheme"]
FIRST_SCREEN = "(() => { try { const h = window.location.hash.slice(1); return %s.includes(h) ? h : 'coach'; } catch (e) { return 'coach'; } })()" % json.dumps(SCREENS).replace('"', "'")

# localStorage keys the app uses, and the demo's own names for them.
STORAGE = {
    "aif-look-v2": "fitron-demo.look",
    **{f"fitron.{k}": f"fitron-demo.{k}" for k in ("avatar", "bg", "chats", "coachCount", "coachPrefs", "content", "dndSetup", "favs", "groc", "ref", "trialEnds", "trialUsed")},
}


UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def once(text, old, new, why):
    assert text.count(old) == 1, f"{why}: expected one match, found {text.count(old)}"
    return text.replace(old, new)


def read_bundle(path):
    src = open(path, encoding="utf-8").read()

    def tag(name):
        m = re.search(r'(<script type="__bundler/%s"[^>]*>)(.*?)(</script>)' % name, src, re.S)
        assert m, f"the export has no {name}"
        return m

    return src, tag("manifest"), tag("template")


def shrink(manifest, template):
    """Drops the font formats nobody needs and turns the big PNGs into WebP. Returns the new manifest and template."""

    def uuid_of(pattern, what):
        # The files' ids change with every export, so each is found by where the page uses it.
        found = set(re.findall(pattern, template, re.S))
        assert len(found) == 1, f"{what}: expected one file, found {len(found)}"
        key = found.pop()
        assert key in manifest, f"{what}: {key} is not in the export"
        return key

    # The icon font: woff2 is supported by every browser that can run the app, so the woff, ttf and svg copies go.
    for fmt in ("woff", "truetype", "svg"):
        key = uuid_of(r'url\("(%s)(?:#[^"]*)?"\) format\("%s"\)' % (UUID, fmt), f"icon font ({fmt})")
        pat = re.compile(r',\s*url\("%s(?:#[^"]*)?"\) format\("%s"\)' % (re.escape(key), fmt), re.I)
        assert len(pat.findall(template)) == 1, f"font {fmt}: expected one @font-face source"
        template = pat.sub("", template)
        assert key not in template
        del manifest[key]

    def webp(key, width, quality):
        img = Image.open(io.BytesIO(base64.b64decode(manifest[key]["data"])))
        if img.width > width:
            img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=quality, method=6)
        manifest[key] = {"mime": "image/webp", "compressed": False, "data": base64.b64encode(buf.getvalue()).decode()}

    # the logo: 1024 px, shown at 120 px or less, many times
    webp(uuid_of(r'\.thinking-logo img\{content:url\("(%s)"\)' % UUID, "logo"), 320, 88)
    # the coach screen's background texture, drawn at 420 px under a 55% wash
    webp(uuid_of(r'url\("(%s)"\);background-size:auto,4[26]0px' % UUID, "background texture"), 852, 62)
    # the picture beside the sign-up questions
    webp(uuid_of(r'class="ob-panel-pic">\s*<sc-if[^>]*><img src="(%s)"' % UUID, "sign-up picture"), 768, 74)
    return manifest, template


def patch(t):
    # 1. the coach talks to the open demo endpoint, and says why when it is not answering
    t = once(t, "fetch('/api/coach', {", "fetch('/api/coach/demo', {", "coach endpoint")
    t = once(
        t,
        "if (r.status === 429) return this.coachOff('Too many messages just now — using built-in replies.', why);",
        "if (r.status === 429) return this.coachOff((d && d.error ? d.error + ' ' : 'Too many messages just now. ') + 'Using built-in replies.', why);",
        "coach limit message",
    )
    # 2. its own storage names
    for old, new in STORAGE.items():
        n = t.count(f"'{old}'")
        assert n >= 1, f"storage key {old} is not in the export any more"
        t = t.replace(f"'{old}'", f"'{new}'")
    assert not re.search(r"'(?:fitron\.[a-zA-Z]+|aif-look-v2)'", t), "an unrenamed storage key is left"
    # The export's own list of picture addresses ("assets/app/….jpg", files that are not in the bundle) would replace the
    # loader's list, which is where React is found, so React would be fetched from unpkg. Without it the app uses the
    # pictures it names itself ("assets/food/poha.jpg"), which are the same files the AI Trainer app serves.
    t, n = re.subn(r"<script>window\.__resources=\{[^<]*\};</script>\n?", "", t)
    assert n == 1, "the export's own window.__resources script is not there as expected"
    assert "window.__resources=" not in t.replace(" ", "")
    # the notification icon is a picture the export names but does not ship; the AI Trainer app has the same logo
    t = t.replace("'assets/app/fitron-logo-gold.jpg'", "'assets/brand/fitron-logo.jpg'")
    t = re.sub(r"""(['"(])assets/""", r"\1/trainer/assets/", t)
    for path in sorted(set(re.findall(r"/trainer/assets/[A-Za-z0-9_./-]+", t))):
        assert os.path.exists(os.path.join(PUBLIC, path.lstrip("/"))), f"{path} is not in public/"
    # 3. signed in on the Coach screen, as the persona
    # (or on the screen the address names after "#", e.g. coach-demo.html#home: the full app demo and the screenshots on
    # /ai-personal-trainer use that)
    t = once(t, "device: 'mobile', screen: 'login',", "device: 'mobile', screen: " + FIRST_SCREEN + ",", "first screen")
    for old, new in PERSONA:
        t = once(t, old, new, f"persona: {old}")
    # the terms and privacy links go to this site's own pages
    t = t.replace("https://fitron-clean.vercel.app/terms.html", "/terms").replace("https://fitron-clean.vercel.app/privacy.html", "/privacy")
    return t


def main(path):
    src, man, tpl = read_bundle(path)
    manifest = json.loads(man.group(2))
    template = json.loads(tpl.group(2))
    manifest, template = shrink(manifest, template)
    template = patch(template)

    def blob(obj):
        # inside a <script>, so "</" must not appear
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    out = src
    # replace the later one first so the earlier offsets stay valid
    for m, obj in sorted(((tpl, template), (man, manifest)), key=lambda x: -x[0].start(2)):
        out = out[: m.start(2)] + blob(obj) + out[m.end(2) :]
    out = once(out, "<title>Bundled Page</title>", "<title>FITRON AI Coach live demo</title>", "page title")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"wrote {os.path.relpath(OUT)}: {len(out) / 1e6:.1f} MB ({len(manifest)} files)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
