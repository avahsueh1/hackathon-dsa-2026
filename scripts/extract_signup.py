#!/usr/bin/env python3
"""Write signup-preview.html: the sign-up page on its own, for redesigning.

Pulls the real markup and the real CSS out of index.html, so what you restyle
is what ships. Both states are shown on one page -- the empty form and the
registered card -- because they need to look right together.

    python3 scripts/extract_signup.py

Restyle `signup-preview.html`, then paste the CSS back into the
"restaurant sign-up" block in index.html. The markup is unchanged, so nothing
else has to move.

Git-ignored: it is generated, and index.html stays the source of truth.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "index.html")
OUT = os.path.join(ROOT, "signup-preview.html")

CSS_START = "/* ================================================== restaurant sign-up ==== */"
SECTION_START = '<section class="tab" id="tab-signup"'

# Styles the sign-up markup leans on that live elsewhere in the sheet.
SHARED = """
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--surface); color: var(--text-primary);
  font-family: var(--sans);
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 28px 24px 64px; }
.btn {
  font-family: inherit; font-size: 13px; font-weight: 500;
  padding: 8px 15px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--border-strong); background: var(--surface-raised);
  color: var(--text-primary);
}
.btn:hover { background: var(--surface-sunken); }
.btn.primary { background: var(--step-500); border-color: var(--step-500); color: #fff; }
.btn.primary:hover { background: var(--step-600); }
.btn:focus-visible { outline: 2px solid var(--step-500); outline-offset: 2px; }
.previewnote {
  font-size: 12.5px; line-height: 1.6; color: var(--text-secondary);
  background: var(--surface-sunken); border: 1px solid var(--border-subtle);
  border-radius: 8px; padding: 12px 15px; margin-bottom: 22px; max-width: 640px;
}
.previewnote b { color: var(--text-primary); }
.statelabel {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--text-muted); font-weight: 600; margin: 26px 0 8px;
}
"""


def grab(text, start_marker, end_pat):
    i = text.index(start_marker)
    m = re.search(end_pat, text[i:])
    return text[i:i + m.start()] if m else text[i:]


def main():
    if not os.path.exists(PAGE):
        sys.exit("no index.html -- run scripts/rebuild_all.py first")
    with open(PAGE, encoding="utf-8") as fh:
        html = fh.read()

    # design tokens
    m = re.search(r":root \{(.*?)\n\}", html, re.S)
    if not m:
        sys.exit("could not find the :root token block")
    tokens = ":root {" + m.group(1) + "\n}"

    if CSS_START not in html:
        sys.exit("could not find the sign-up CSS block")
    # The block runs from its banner to the panel marker that follows it.
    ci = html.index(CSS_START)
    cj = html.index("/*__PANEL_CSS__*/", ci)
    css = html[ci:cj].rstrip()

    if SECTION_START not in html:
        sys.exit("could not find the sign-up section")
    i = html.index(SECTION_START)
    j = html.index("</section>", i) + len("</section>")
    section = html[i:j]

    # The chips and day buttons are built by JS at runtime, so a static
    # preview would show empty rows and their styles would go unnoticed.
    # Inject the real markup the JS produces.
    chips = "".join('<button type="button" class="chip"%s>%d</button>'
                    % (' aria-pressed="true"' if v == 25 else "", v)
                    for v in (10, 25, 50, 100))
    days = "".join('<button type="button" class="day"%s>%s</button>'
                   % (' aria-pressed="true"' if d in ("Fri", "Sat") else "", d)
                   for d in ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"))
    section = section.replace('<div class="chiprow" id="su-typical-chips"></div>',
                              '<div class="chiprow" id="su-typical-chips">%s</div>' % chips)
    section = section.replace('<div class="daysrow" id="su-days"></div>',
                              '<div class="daysrow" id="su-days">%s</div>' % days)

    # An error state, so the red styling is visible to design against.
    section = section.replace(
        '<p class="err" data-for="su-email" hidden>',
        '<p class="err" data-for="su-email">')
    section = section.replace('id="su-email" name="email" autocomplete="email"',
                              'id="su-email" name="email" autocomplete="email" aria-invalid="true"')

    # show both states side by side, and strip the tab machinery
    section = section.replace(' hidden>', '>', 1)
    form_state = section.replace('id="reg-card" hidden', 'id="reg-card" hidden')
    both = section.replace('<div class="regcard" id="reg-card" hidden>',
                           '<div class="regcard" id="reg-card">')

    page = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-up page — design preview</title>
<style>
%s
%s
%s
</style>
</head>
<body>
<div class="wrap">

  <p class="previewnote">
    <b>Design preview.</b> This is the real sign-up markup and the real CSS,
    lifted out of <code>index.html</code> so it can be restyled on its own.
    Both states are shown: the registered card and the empty form. Change the
    CSS here, then paste it back into the
    <code>restaurant sign-up</code> block in <code>index.html</code> — the
    markup is untouched, so nothing else has to move.
    Regenerate with <code>python3 scripts/extract_signup.py</code>.
  </p>

  <div class="statelabel">State 1 — already registered</div>
%s

  <div class="statelabel">State 2 — the form</div>
%s

</div>
</body>
</html>
""" % (tokens, SHARED, css,
       both.replace('<section class="tab" id="tab-signup" role="tabpanel" aria-labelledby="tb-signup">',
                    '<div class="signupwrap-outer">')
            .replace('</section>', '</div>')
            .split('<!-- ============ the form ============ -->')[0] + "</div></div>",
       section.replace('<section class="tab" id="tab-signup" role="tabpanel" aria-labelledby="tb-signup">',
                       '<div class="signupwrap-outer">')
              .replace('</section>', '</div>'))

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("signup-preview.html  %.1f KB" % (os.path.getsize(OUT) / 1024.0))
    print("  tokens  %d chars" % len(tokens))
    print("  css     %d chars" % len(css))
    print("  markup  %d chars" % len(section))


if __name__ == "__main__":
    main()
