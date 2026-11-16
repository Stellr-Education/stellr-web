#!/usr/bin/env python3
"""Build the files for the Claude Design System artifact "Stellr Design System"
(see .design-sync/NOTES.md, "Design System artifact").

Maps the design-sync converter output plus the repo's compiled tokens into the
artifact's project/ layout, and copies the hand-written sources in
.design-sync/artifact/ (README, cover, logo notes).

Usage (from a checkout, after `npm run build:tokens` and a Storybook build):
  node .ds-sync/package-build.mjs --config .design-sync/config.json \
    --node-modules ./node_modules --storybook-static <sb-out> --out <conv-out>
  python3 -I .design-sync/tools/to-design-system-artifact.py \
    <checkout> <conv-out> <dest-dir> <iso-timestamp> <branch@sha>
Then render-check with tools/artifact-render-check.mjs and publish <dest-dir>/project/
to the artifact (the .d.ts files need contentType text/plain)."""
import json, re, sys, shutil, os
from pathlib import Path

WT, SRC, DEST = map(Path, sys.argv[1:4])
P = DEST / 'project'
P.mkdir(parents=True, exist_ok=True)
NOW = sys.argv[4]
REF = sys.argv[5]

# ---------- tokens.json from styles/tokens.css (the repo's compiled names) ----------
css = (WT / 'styles/tokens.css').read_text()
rows = re.findall(r'--([a-z0-9-]+):\s*([^;]+);(?:\s*/\*\*\s*(.*?)\s*\*/)?', css)
fallback = {
  'color-white': 'Cards, inputs and section backgrounds; text on midnight and on primary fills.',
  'color-text-primary': 'Strong body text and labels on white and surface.',
  'color-text-body': 'Body copy on white and surface.',
  'color-text-secondary': 'Secondary lines and captions on white and surface.',
  'color-text-muted': 'Muted meta text on white.',
  'color-border-light': 'Faint internal dividers inside cards and tables.',
  'bracket-school-tint': 'Selected and chip backgrounds for the high-school bracket.',
  'bracket-college-tint': 'Selected and chip backgrounds for the college bracket.',
  'bracket-college-deep': 'Text and selected fills for the college bracket.',
  'bracket-adult-tint': 'Selected and chip backgrounds for the adults bracket.',
  'theme-tint-space-bg': 'Space theme section and card background.',
  'theme-tint-space-chip': 'Space theme chips and icon tiles.',
  'theme-tint-space-text': 'Space theme text on its tints.',
  'theme-tint-enviro-bg': 'Environmental theme section and card background.',
  'theme-tint-enviro-chip': 'Environmental theme chips and icon tiles.',
  'theme-tint-enviro-text': 'Environmental theme text, on white and its tints (enviro green itself is fills only).',
  'theme-tint-primary-soft-bg': 'Soft blue fills: softBlue buttons, selected rows, info panels.',
  'theme-tint-amber-soft-bg': 'Soft amber fills: softAmber buttons, pathway notes.',
  'radius-control': 'Inputs, selects, small buttons and controls.',
  'radius-card': 'Cards (rounded-ds-card).',
  'radius-panel': 'Panels and grouped content (rounded-panel).',
  'radius-cta': 'The closing CtaBand.',
  'radius-pill': 'Pills, badges and pill buttons.',
  'shadow-card-lift': 'Card hover lift.',
  'shadow-featured': 'The one featured card in a set (shadow-featured).',
  'shadow-panel': 'Floating panels and dialogs.',
}
colors, spacing, radius, shadow, focus, fams = [], [], [], [], [], {}
fs, ls = {}, {}
for name, val, note in rows:
    val = val.strip(); note = (note or '').strip() or fallback.get(name, '')
    t = {'name': name, 'value': val, 'usage': note}
    if name.startswith(('color-', 'bracket-', 'tier-', 'theme-tint-')):
        colors.append(t)
    elif name in ('focus-ring-color', 'focus-ring-halo'):
        t['value'] = '{color-primary}' if name.endswith('color') else '{color-white}'
        colors.append(t)
    elif name.startswith('focus-ring-'):
        focus.append(t)
    elif name.startswith('radius-'):
        radius.append(t)
    elif name.startswith('space-'):
        spacing.append(t)
    elif name.startswith('shadow-'):
        shadow.append(t)
    elif name.startswith('font-size-'):
        fs[name[10:]] = (val, note)
    elif name.startswith('letter-spacing-'):
        ls[name[15:]] = val
    elif name.startswith('font-'):
        fams[name[5:]] = (val, note)
missing = [t['name'] for t in colors + spacing + radius + shadow + focus if not t['usage']]
assert not missing, missing

stack = {
  'display': "'Space Grotesk', system-ui, sans-serif",
  'body': "'Hanken Grotesk', system-ui, sans-serif",
  'competition-display': "Norwester, 'Space Grotesk', sans-serif",
  'competition-body': "Aileron, 'Hanken Grotesk', sans-serif",
}
assert set(stack) == set(fams), fams.keys()
# desktop size for fluid clamps (the clamp max), the full range in usage
def size(v):
    m = re.match(r'clamp\(([^,]+),[^,]+,\s*([^)]+)\)', v)
    return (m.group(2).strip(), True) if m else (v, False)
def style(n, key, lh, fam, weight, sample, extra=''):
    v, note = fs[key]; s, fluid = size(v)
    u = (note + ' ' if note else '') + ('Source value: ' + v + '. ' if fluid else '') + extra
    st = {'name': n, 'fontSize': s, 'lineHeight': lh, 'fontWeight': weight, 'family': fam, 'sample': sample, 'usage': u.strip()}
    return st
lsd, lsh, lse = ls['display'], ls['heading'], ls['eyebrow']
display = [
  dict(style('h1', 'h1', 1.05, 'display', 700, 'Design Competitions', 'Page title in the Hero, white on midnight (text-ds-h1).'), letterSpacing=lsd),
  dict(style('h2', 'h2', 1.1, 'display', 700, 'Choose how you take part', 'Section headings in ink (text-ds-h2).'), letterSpacing=lsh),
  style('h3', 'h3', 1.3, 'display', 600, 'Innovator tier', 'Card and sub-section headings (text-ds-h3).'),
]
text = [
  style('lead', 'lead', 1.5, 'body', 400, 'Real professional STEM skills for high school students.', 'Hero and section lead paragraphs (text-ds-lead).'),
  style('body', 'body', 1.6, 'body', 400, 'Monthly hands-on workshops, plus a community where asking questions is the point.', 'Body copy in color-text-body (text-ds-body).'),
  dict(style('eyebrow', 'eyebrow', 1.4, 'body', 700, 'STEP 1', 'Uppercase labels above headings (text-ds-eyebrow).'), letterSpacing=lse),
  style('meta', 'meta', 1.4, 'body', 400, '2027 school year · set in 2052', 'Meta lines, captions and fine print (text-ds-meta).'),
  style('input', 'input', 1.5, 'body', 400, 'you@school.org', 'Text inside form fields on phones and tablets.'),
]
for g in display + text:
    if 'letterSpacing' in g: g['letterSpacing'] = g['letterSpacing']
fonts = [
  {'family': 'Norwester', 'file': 'fonts/norwester.otf', 'weight': '400', 'style': 'normal'},
  {'family': 'Aileron', 'file': 'fonts/Aileron-Light.otf', 'weight': '300', 'style': 'normal'},
  {'family': 'Aileron', 'file': 'fonts/Aileron-Regular.otf', 'weight': '400', 'style': 'normal'},
  {'family': 'Aileron', 'file': 'fonts/Aileron-Italic.otf', 'weight': '400', 'style': 'italic'},
  {'family': 'Aileron', 'file': 'fonts/Aileron-SemiBold.otf', 'weight': '600', 'style': 'normal'},
  {'family': 'Aileron', 'file': 'fonts/Aileron-Bold.otf', 'weight': '700', 'style': 'normal'},
]
tokens = {
  'name': 'Stellr Design System', 'version': 2,
  'color': {'themes': [{'id': 'light', 'name': 'Light'}], 'tokens': colors},
  'type': {'fonts': fonts, 'families': stack, 'groups': [
      {'name': 'Display', 'family': 'display', 'styles': display},
      {'name': 'Text', 'family': 'body', 'styles': text}]},
  'spacing': {'note': 'Page rhythm and layout widths. Component padding uses Tailwind steps compiled into bundle.css.', 'tokens': spacing},
  'radius': {'tokens': radius},
  'shadow': {'tokens': shadow},
  'focusRing': {'note': 'Focus ring geometry; its colours are focus-ring-color and focus-ring-halo.', 'tokens': focus},
  'meta': {'source': 'github', 'repo': 'aussie-spaceman/stellr-web', 'ref': REF, 'package': 'packages/web-ui',
           'paths': {'tokens': ['design/tokens.json', 'styles/tokens.css'], 'fonts': ['public/fonts', 'lib/fonts.ts'],
                     'assets': ['public/images'], 'docs': ['CLAUDE.md', 'VOICE.md', '.design-sync/conventions.md']},
           'components': {}, 'synced': NOW[:10]},
}

# ---------- components ----------
SUMMARY = {
 'AudioTestimonial': 'An audio-only testimonial: native audio controls with the transcript offered as a PDF download, so the clip works without sound.',
 'AwardTile': 'One competition award: what it is, how many are given and who decides, in the gold support colour.',
 'Badge': 'A small pill label, such as the "Best Value" banner on a featured tier.',
 'BracketShadeKey': 'A legend of the three bracket ramps (school, college, adults), each a row of tier-shade chips from light to deep.',
 'Button': 'The action button or link, in eight variants from primary to outlineWhite for midnight grounds.',
 'Choice': 'A checkbox or radio with its label, sized for a fingertip (44px row, 20px box).',
 'Collapsible': 'A disclosure section with a title, optional summary and actions, that expands to show its body.',
 'ConfirmDialog': 'A dialog that asks before something that cannot be undone; the confirm button takes focus.',
 'CtaBand': 'The navy call-to-action band that closes a page.',
 'Dialog': 'A modal dialog with a scroll lock; only the top dialog answers Escape.',
 'EraCycle': 'The rotation of competition eras across school years, with the current year marked in space-violet.',
 'Eyebrow': 'The small uppercase label set above a heading.',
 'Field': 'A labelled form control that wires its hint and error text to the control for assistive tech.',
 'Fieldset': 'A group of choices or related fields under one legend.',
 'GuaranteeBadge': 'The guarantee mark, full or compact (one line beside a price or a pay button), with an onDark form for midnight.',
 'Hero': 'The dark navy hero at the top of public pages: breadcrumb, title, lead and pills on a midnight gradient.',
 'InfoPill': 'The translucent pill used on the dark hero.',
 'Input': 'A text input in the shared field look: 16px text on touch screens, 44px minimum height, a 3:1 border.',
 'PathwayCard': 'A card for one way to take part, with an eyebrow, a tagline, detail rows and a call to action.',
 'ProgressionGraphic': 'A row of progression steps under a heading, showing how a member moves from one stage to the next.',
 'ProofStrip': 'A strip of event photos (a scroller on mobile, a grid on desktop) that opens a keyboard-navigable lightbox.',
 'PullQuoteWall': 'A wall of pull quotes from members, mentors and educators.',
 'SectionHeading': 'A section heading: an H2 with either a numbered step or a plain eyebrow above it.',
 'Select': 'A select menu in the shared field look.',
 'StepCard': 'A numbered step with a title and body text.',
 'Textarea': 'A multi-line text field in the shared field look.',
 'ThemeCard': 'A card for one competition theme (Space or Environmental), with its icon, blurb and links to explore or read the brief.',
 'TierCard': 'A membership or competition tier: name, price, what is included and how it inherits from the tier below.',
 'VideoTestimonial': 'A video testimonial with captions; a clip without captions logs a warning so it never ships unnoticed.',
 'WorkCard': 'A piece of downloadable student or program work, with an email gate for gated files.',
}
HEIGHT = {'Hero': 520, 'CtaBand': 320, 'Dialog': 520, 'ConfirmDialog': 360, 'TierCard': 560, 'PathwayCard': 520,
          'ThemeCard': 560, 'ProgressionGraphic': 360, 'ProofStrip': 420, 'PullQuoteWall': 480, 'WorkCard': 420,
          'VideoTestimonial': 420, 'AudioTestimonial': 280, 'EraCycle': 300, 'BracketShadeKey': 220, 'StepCard': 260,
          'Collapsible': 320, 'GuaranteeBadge': 240, 'AwardTile': 260}
WIDTH = {'TierCard': 1000}
GROUPNAME = {'primitives': 'Primitives', 'forms': 'Forms', 'overlays': 'Overlays', 'sections': 'Sections',
             'competition': 'Competition', 'foundations': 'Foundations', 'media': 'Media', 'trust': 'Trust'}

comp_dirs = sorted(d for d in (SRC / 'components').glob('*/*') if d.is_dir())
names, dts_all = [], []
for d in comp_dirs:
    group, n = d.parent.name, d.name
    names.append(n)
    out = P / 'components' / n
    out.mkdir(parents=True, exist_ok=True)
    # preview.html: frame preloads tokens.css, bundle.css, libraries and bundle.js
    html = (d / f'{n}.html').read_text()
    prev = (SRC / '_preview' / f'{n}.js').read_text()
    assert '</script' not in prev.lower(), n
    html = html.split('\n', 1)[1]                                   # drop old marker
    html = re.sub(r'\s*<link rel="stylesheet"[^>]*>', '', html)
    html = re.sub(r'\s*<script src="[^"]*(_vendor/[^"]*|_ds_bundle\.js)"></script>', '', html)
    m = re.search(r'\s*<script src="[^"]*_preview/' + re.escape(n) + r'\.js"></script>\s*<script>', html)
    assert m, n
    html = html[:m.start()] + '\n  <script>\n' + prev + '\n' + html[m.end():]
    assert html.count('<script') == 1, (n, html.count('<script'))
    marker = f'<!-- @dsCard group="{GROUPNAME[group]}" height={HEIGHT.get(n, 200)}'
    if n in WIDTH: marker += f' width={WIDTH[n]}'
    marker += ' -->\n'
    (out / 'preview.html').write_text(marker + html)
    assert (out / 'preview.html').stat().st_size < 256 * 1024, n
    # README.md from the converter's .prompt.md; first sentence = summary
    pm = (d / f'{n}.prompt.md').read_text().split('\n', 1)[1].lstrip('\n')
    pm = re.sub(r'Variants \(see `[^`]*`\): ', 'Stories shown in the preview: ', pm)
    (out / 'README.md').write_text(SUMMARY[n] + ' Use it as `window.StellrWebUI.' + n + '`.\n\n' + pm)
    # types
    dts = (d / f'{n}.d.ts').read_text()
    (out / f'{n}.d.ts').write_text(dts)
    dts_all.append(f'// ── {n} ──\n' + re.sub(r"^import \* as React from 'react';\n", '', dts))
    src_path = re.search(r'\(\./([^)]+)\)', dts)
    tokens['meta']['components'][n] = src_path.group(1) if src_path else ''
assert set(names) == set(SUMMARY), set(names) ^ set(SUMMARY)

(P / 'components/index.d.ts').write_text("import * as React from 'react';\n\n" + '\n'.join(dts_all))

# bundle.js: one classic script, header rewritten to format 4
b = (SRC / '_ds_bundle.js').read_text()
first, rest = b.split('\n', 1)
assert first.startswith('/* @ds-bundle:') and first.endswith('*/')
hdr = {'format': 4, 'namespace': 'StellrWebUI', 'components': [{'name': n} for n in sorted(names)]}
b = '/* @ds-bundle: ' + json.dumps(hdr, separators=(',', ':')) + ' */\n' + rest
assert '</script' not in b.lower() and '<!--' not in b
(P / 'components/bundle.js').write_text(b)

# bundle.css: Google faces first, then the compiled Tailwind + token CSS
brand = (WT / '.design-sync/fonts/brand-fonts.css').read_text()
bc = (SRC / '_ds_bundle.css').read_text().replace('url(./fonts/', 'url(../fonts/')
assert '</style' not in bc.lower()
(P / 'components/bundle.css').write_text(brand + '\n' + bc)

# libraries: React 19 as the converter vendored it (react.js defines both globals)
(P / 'components/lib').mkdir(exist_ok=True)
shutil.copy(SRC / '_vendor/react.js', P / 'components/lib/react.js')
shutil.copy(SRC / '_vendor/react-dom.js', P / 'components/lib/react-dom.js')
for f in ('react.js', 'react-dom.js'):
    assert '</script' not in (P / 'components/lib' / f).read_text().lower()

# fonts
(P / 'fonts').mkdir(exist_ok=True)
for f in fonts:
    shutil.copy(SRC / f['file'], P / f['file'])

(P / 'tokens.json').write_text(json.dumps(tokens, indent=2, ensure_ascii=False) + '\n')

# tokens.css, laid out as the page compiles it
L = ['/* Stellr Design System — generated from tokens.json */']
L.append(':root, [data-theme="light"] {')
for t in colors:
    v = t['value']; v = 'var(--' + v[1:-1] + ')' if v.startswith('{') else v
    L.append(f'  --{t["name"]}: {v};')
for t in shadow: L.append(f'  --{t["name"]}: {t["value"]};')
L.append('}')
L.append(':root {')
for t in spacing + radius + focus: L.append(f'  --{t["name"]}: {t["value"]};')
for k, v in stack.items(): L.append(f'  --font-{k}: {v};')
L.append('}')
for g in tokens['type']['groups']:
    for s in g['styles']:
        decl = f'font-family: var(--font-{s["family"]}); font-size: {s["fontSize"]}; line-height: {s["lineHeight"]}; font-weight: {s["fontWeight"]};'
        if 'letterSpacing' in s: decl += f' letter-spacing: {s["letterSpacing"]};'
        L.append(f'.{s["name"]} {{ {decl} }}')
for f in fonts:
    L.append(f"@font-face {{ font-family: '{f['family']}'; src: url('{f['file']}'); font-weight: {f['weight']}; font-style: {f['style']}; font-display: swap; }}")
(P / 'tokens.css').write_text('\n'.join(L) + '\n')

# hand-written sources kept in the repo
A = WT / '.design-sync/artifact'
for f in A.rglob('*'):
    if f.is_file():
        t = P / f.relative_to(A); t.parent.mkdir(parents=True, exist_ok=True); shutil.copy(f, t)

print('components', len(names), 'colors', len(colors), 'styles', len(display) + len(text),
      'bundle', (P / 'components/bundle.js').stat().st_size, 'css', (P / 'components/bundle.css').stat().st_size)
