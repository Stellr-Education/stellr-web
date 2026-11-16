Stellr Education's design system (V2) for the public site, the member app and admin: a dark navy hero over light content, Space Grotesk headings, Hanken Grotesk body text, and colour that always carries meaning. Build with the components on `window.StellrWebUI` before writing your own markup.

## Content fundamentals

We are a professional organisation running professional events. The voice is professional and human.

- **Treat the audience as capable**, even 12-year-olds. Never dumb it down; explain an unfamiliar term in passing.
- **Specifics beat aspirations.** "Monthly hands-on workshops" beats "transform your relationship with science."
- **Be concise.** If a sentence still works with a word removed, remove it.
- **Fun and optimistic**, never hype. Everything points at humanity expanding into the solar system.
- **Second person, benefit-led** on marketing pages ("Hands-on STEM events, every month, plus a community where asking questions is the point."). Member content says exactly what you get and what is expected. Transactional copy is warm, functional and short ("You're registered for [Event] on [Date]. Zoom link arrives one hour before.").
- **Same names everywhere.** Tier names (Explorer, Pathfinder, Scholar; Alumni, Contributor, Counselor; Educator, Catalyst, Innovator, Trailblazer) and program names match on every page.
- **Earn every element.** No filler stats, no decorative icons.

| Audience | Lean into | Avoid |
|---|---|---|
| School students | Concrete things you'll do, "you don't need to know any X to start" | School-admin tone, "exciting opportunities", talking down |
| College students | Time-respect ("a 90-minute workshop, not a semester") | Pity, unexplained jargon |
| Educators | Practical value to them and their students | Edtech sales-speak |
| Parents | What their student gets, safety and privacy specifics | Hype, vague claims, unfounded statistics |
| Donors and sponsors | Concrete impact, who you reach | "Transforming lives" |

## Visual foundations

**Page shape.** A dark `Hero` on `color-midnight` at the top, then light sections on `color-white` or `color-surface`, closed by a `CtaBand`. Content sits in a 1080px column (`space-content-max`); header and footer chrome in 1240px (`space-chrome-max`). Space sections `space-section` (64px) apart with `space-gutter` (32px) side padding. Introduce each section with `SectionHeading`, either an eyebrow or a numbered step. Sequence decisions one axis at a time: never ask a visitor to pick a theme, a pathway and a tier in the same block.

**Colour codes meaning.** Never use a hue as decoration.
- Action: `color-primary` (hover `color-primary-deep`). 5.2:1 on white, as text and under white text.
- Theme: Space is `color-space-violet` with the `theme-tint-space-*` tints; Environmental is `color-enviro-green` with `theme-tint-enviro-*`. Enviro green is for fills and icons only (3.8:1): set its text in `theme-tint-enviro-text`.
- Pathway: `color-primary` or `color-pathway-amber`.
- Support and donate: `color-donate-gold`, `color-star-gold`. Gold or amber as text is always `color-gold-ink`; amber and gold fills carry ink text, never white.
- Brackets (who a tier is for): school `bracket-school-*`, college `bracket-college-*`, adults `bracket-adult-*`. Tiers shade each bracket's ramp from light (base) to deep (top), as `BracketShadeKey` shows.
- Negative copy: `color-danger`.

**Text.** Headings in `color-ink`, body in `color-text-body`, secondary lines in `color-text-secondary`, the quietest light-ground text in `color-text-faint` (4.5:1 on `color-surface`). On midnight use white, `color-hero-lead` for lead paragraphs and `color-hero-muted` for secondary lines. Nothing is set smaller than 12px.

**Type.** Space Grotesk (`display`) for headings and display at 500–700; Hanken Grotesk (`body`) for body and UI at 400–700. `h1`, `h2` and `lead` are fluid; their styles show the desktop size and the usage notes give the full range. Form-field text is 16px on phones (`input`), or iOS Safari zooms. Norwester and Aileron (`competition-display`, `competition-body`) are for competition print and slide materials only: never use them in site or app UI.

**Shape and depth.** Radii by role: `radius-control` (8px) for inputs and small controls, `radius-card` (14px) for cards, `radius-panel` (18px) for panels and grouped content, `radius-cta` (22px) for the closing CTA band, `radius-pill` for pills and badges. Borders before shadows: `color-border` for dividers and card edges, `color-border-strong` for form-control edges (3.3:1, the WCAG minimum for a control). Shadows are rare and soft: `shadow-card-lift` on hover, `shadow-featured` on the one featured card, `shadow-panel` under floating panels.

**Focus.** Every interactive element shows a solid `focus-ring-color` ring, `focus-ring-width` thick, with a `focus-ring-halo` gap of `focus-ring-offset` between it and the element.

**Imagery.** Event photography shows large groups, student work or the venue, and adults working with students; the action is design, not hardware. Created imagery shows hardware plausible within about 25 years, framed against infrastructure or a celestial body, never a bare starscape.

## Iconography

Brand icons come from `@stellr/icons`, bundled here: `Orbit`, `Satellite`, `Telescope`, `Launch`, `Award`, `Certificate`, `Document`, `Environment`, `Event`, `Global`, `Idea`, `Team`, plus `Facebook`, `Instagram`, `Linkedin` and `Twitter`. They are 24px line icons with a stroke of about 1.8px, drawn in `currentColor`. General UI icons (check, close, arrows) use lucide-react at the same weight. Don't paste raw SVG or redraw a lucide icon as a brand icon. Logos are under Assets: use `logo-horiz-tight.svg` on light grounds and `logo-icon.svg` where space is tight.

## Building with the components

Every component is on `window.StellrWebUI`. No provider or theme wrapper is needed; the bundle defines the font variables when it loads.

- Use the library before your own markup: `Button` (variants `primary`, `secondary`, `energy`, `softBlue`, `softAmber`, `primaryStrong`, `secondaryStrong`, and `outlineWhite` on midnight; `href` makes it a link), `Badge`, `Eyebrow`, `InfoPill` (on dark only), `TierCard`, `PathwayCard`, `ThemeCard`, `StepCard`, `GuaranteeBadge`, `Collapsible`.
- Every form control goes inside `Field`, which wires the label, hint and error. Group radios and checkboxes with `Fieldset` and `Choice`.
- Overlays use `Dialog`, or `ConfirmDialog` before anything that can't be undone.
- Components take the router's link through `as` or `linkAs` (`<Button href="/events" as={Link}>`).
- Style your own layout glue with the Tailwind token utilities already compiled into `components/bundle.css`: `bg-midnight`, `bg-surface`, `text-ink`, `text-content-body`, `border-line`, `rounded-ds-card`, `rounded-panel`, `shadow-featured`, `max-w-content`, `section-padding`. There is no Tailwind compiler in a design, so a class that isn't in `bundle.css` does nothing. Where no utility exists, use the token: `style={{ color: 'var(--color-ink)' }}`. Never write raw hex or font names.

```jsx
const { Hero, SectionHeading, TierCard, CtaBand, Button } = window.StellrWebUI;

<>
  <Hero breadcrumb="Educate → Competitions" title="Design Competitions"
    lead="Real professional STEM skills for high school students."
    pills={['High school students', 'Free for students to enter']} />
  <section className="bg-surface section-padding">
    <div className="max-w-content mx-auto px-4">
      <SectionHeading step="STEP 1" title="Choose how you take part" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TierCard name="Educator" price="Free" accessNote="Free with a member account" items={['NSES map', 'Worksheets']} />
        <TierCard name="Innovator" price="$500" badge="Best Value" featured inheritsFrom="Educator" items={['Marking rubric', 'Lesson plans']} />
      </div>
    </div>
  </section>
  <CtaBand title="Ready to start?" body="Register for an upcoming live event."
    actions={<Button href="/events" variant="primary">View Events</Button>} />
</>
```

This system is synced from the stellr-web repository. Change it in the code and run `/design-sync` again; edits on this page are not kept.
