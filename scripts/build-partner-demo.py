#!/usr/bin/env python3
"""Builds public/site/partner-demo.html, the Partner Console live demo on the home page, from the Partner Portal
prototype (prototype/Fitron Partner Portal.html, a single-file design export).

    python3 scripts/build-partner-demo.py [path/to/Fitron Partner Portal.html]

The prototype is both consoles, FITRON's owner console and the gym partner's, on demo data. The demo is the gym partner's
console only, as a gym owner would use it, with these changes so that it can live on fitron.in:

  1. It opens signed in as the sample partner gym, on its home page with "How your partnership works", and its sign-in
     page offers only the gym partner role: FITRON's own owner console is not part of the demo.
  2. The gym's share is the real one, PARTNER_SHARE in src/lib/domain/pricing.ts (70%), worked out on the price before
     GST as the Gym Partnership page does (landing-page.test.ts keeps the share equal).
  3. Links that pointed at other prototype files point at the real pages, and WhatsApp support at the site's number.

It talks to no backend: src/lib/csp.ts keeps the site from connecting anywhere but its own server, and the prototype's
backend config is empty, so everything stays in the page. Every edit asserts that it applies, so a new export that changes
the text we look for stops with a message instead of being published half-patched.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "prototype", "Fitron Partner Portal.html")
OUT = os.path.join(ROOT, "public", "site", "partner-demo.html")

SHARE = 70  # PARTNER_SHARE, as a percentage
GST = "1.18"  # AI Trainer prices include 18% GST; the share is on the price before it
SUPPORT_WA = "916207774673"  # the WhatsApp number on fitron.in


def once(text, old, new, why):
    assert text.count(old) == 1, f"{why}: expected one match, found {text.count(old)}"
    return text.replace(old, new)


def every(text, old, new, why):
    assert old in text, f"{why}: not found"
    return text.replace(old, new)


EDITS = [
    # 1. Signed in as the partner gym, gym partner role only.
    ('&quot;default&quot;:30,&quot;min&quot;:10', f'&quot;default&quot;:{SHARE},&quot;min&quot;:10', "share setting default"),
    ("&quot;default&quot;:&quot;Owner&quot;", "&quot;default&quot;:&quot;Gym partner&quot;", "start role default"),
    ("role: this.props.startRole === 'Gym partner' ? 'gym' : 'owner', screen: 'login',", "role: 'gym', screen: 'dash',", "open signed in as the gym"),
    ("[['owner','Owner','crown'],['gym','Gym partner','barbell']]", "[['gym','Gym partner','barbell']]", "sign-in page: gym partner only"),
    ("const G0 = Math.min(90, Math.max(0, P.gymShare ?? 30));", f"const G0 = {SHARE};", "the real share"),
    # 2. Earnings on the price before GST.
    ("const rev = 38 * 299 + 14 * 499;\n    return { name:'Iron Temple Gym', city:'Patna', code:'IRONTEMPLE', share: G, method:'route', rev, earn: rev * G / 100, next: rev * G / 100,",
     f"const rev = 38 * 299 + 14 * 499;\n    return {{ name:'Iron Temple Gym', city:'Patna', code:'IRONTEMPLE', share: G, method:'route', rev, earn: rev / {GST} * G / 100, next: rev / {GST} * G / 100,",
     "sample gym earnings before GST"),
    ("earn: m.status === 'Paid' ? '+' + this.inr((m.plan === 'premium' ? 499 : 299) * G / 100)",
     f"earn: m.status === 'Paid' ? '+' + this.inr((m.plan === 'premium' ? 499 : 299) / {GST} * G / 100)", "member earnings before GST"),
    ("pro = 299 * G / 100, prem = 499 * G / 100;", f"pro = 299 / {GST} * G / 100, prem = 499 / {GST} * G / 100;", "explainer earnings before GST"),
    ("gymEarnSub: 'From ' + this.inr(Gd.rev) + ' paid by your members · ' + G + '% share',",
     "gymEarnSub: 'From ' + this.inr(Gd.rev) + ' paid by your members · ' + G + '% of the price before GST',", "earnings card note"),
    ("You bring the members, and you keep {{ gymPctTxt }} of everything they pay, every month.",
     "You bring the members, and you keep {{ gymPctTxt }} of what they pay before GST, every month.", "explainer intro"),
    ("<div style=\"font-size:12.5px;color:#6d6555;margin-top:2px\">Split of every rupee a member pays, before GST</div>",
     "<div style=\"font-size:12.5px;color:#6d6555;margin-top:2px\">Split of every rupee a member pays, before GST. Example figures, not guaranteed income.</div>", "split note"),
    # 3. Links and labels for fitron.in.
    ('<a href="Fitron App v2.dc.html" style="color:#D9B45A;font-weight:700">← Back to the member app</a>',
     '<a href="/ai-personal-trainer" target="_top" style="color:#D9B45A;font-weight:700">← The AI Trainer for members</a>', "sign-in page link"),
    ("go: () => { window.location.href = 'Fitron Legal.dc.html'; } }", "go: () => window.open('/terms#partners', '_blank', 'noopener') }", "policies link"),
    ("go: () => { window.location.href = 'Fitron App v2.dc.html'; } }", "go: () => window.open('/ai-personal-trainer', '_blank', 'noopener') }", "member app link"),
    ("'Demo data · connect backend to go live'", "'Demo data · sample gym'", "header note"),
    (">Partner &amp; owner console</div>", ">Gym partner console</div>", "sign-in page subtitle"),
    ("'Refer your members to Fitron and earn ' + G0 + '% of every payment they make.'",
     "'Refer your members to Fitron and earn ' + G0 + '% of what they pay, before GST.'", "sign-in page intro"),
    ("gymNote: 'You earn ' + G + '% of every payment your referred members make.", "gymNote: 'You earn ' + G + '% of what your referred members pay, before GST.", "gym note"),
    ("t:'You earn ' + (Gd.share ?? G0) + '% of every payment'", "t:'You earn ' + (Gd.share ?? G0) + '% of every payment, before GST'", "refer page step 3"),
    ("d: (Gd ? Gd.share ?? G0 : G0) + '% of every member payment'", "d: (Gd ? Gd.share ?? G0 : G0) + '% of every member payment, before GST'", "account page share"),
]


def main():
    src = open(SRC, encoding="utf-8").read()
    m = re.search(r'(<script type="__bundler/template">\s*)(.*?)(\s*</script>)', src, re.S)
    assert m, "the export has no template"
    tpl = json.loads(m.group(2))
    for old, new, why in EDITS:
        tpl = once(tpl, old, new, why)
    tpl = every(tpl, "wa.me/917320001062", f"wa.me/{SUPPORT_WA}", "support WhatsApp number")
    enc = json.dumps(tpl, ensure_ascii=False).replace("</", "<\\u002F")
    assert json.loads(enc) == tpl
    out = src[: m.start(2)] + enc + src[m.end(2):]
    out = once(out, "<title>Bundled Page</title>", "<title>FITRON Partner Console · live demo</title>", "page title")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print("Wrote", os.path.normpath(OUT), f"({len(out) // 1024} KB)")


if __name__ == "__main__":
    main()
