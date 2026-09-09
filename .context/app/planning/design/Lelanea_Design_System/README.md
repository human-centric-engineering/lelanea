# Lelanea Design System

A design system for **Lelanea's App** — a coaching experience where clients interact with an AI trained on Lelanea's **Unity Consciousness** work.

The signature element is a **lotus flower** that slowly opens when the user launches the app: teal and aqua petals around a warm orange center.

---

## Product context

Lelanea's App is a one-on-one coaching companion. Clients open the app to sit with an AI trained on Lelanea's teachings — asking questions, being witnessed, and practicing reflection. The tone is contemplative and grounded, not techy or clinical. It should feel like a warm room, not a dashboard.

### Audiences
- **Clients / practitioners.** People already in (or drawn to) Lelanea's Unity Consciousness work. They come to integrate teachings, process moments, and deepen practice between sessions.
- **New seekers.** People meeting the work for the first time via the app — onboarding matters, and the first moments (the lotus opening, a gentle welcome) should feel like an invitation, not a signup.

### Surfaces covered here
- **Mobile coaching app** — the primary product. iOS-first feel, portrait, tap-centric. The home screen features the opening lotus animation. Chat is the core interaction.

---

## Sources

No external codebase, Figma, or slide deck was attached for this project. The system is built from the written brief:
- A full color palette with semantic application notes (primary backgrounds, surfaces, typography, action & branding, functional states, selected states, accents).
- A description of the home screen animation (lotus opening in blues + oranges).
- Product positioning: coaching app + AI trained on Unity Consciousness work.

If you (the reader) have access to a codebase, Figma file, or existing brand assets for Lelanea, please attach them — a second pass will tighten this system to match production fidelity.

---

## Index

Root of this project:

- `README.md` — you are here.
- `SKILL.md` — cross-compatible skill definition (usable in Claude Code).
- `styles.css` — global stylesheet entry (imports the tokens below).
- `colors_and_type.css` — CSS variables for the color palette + typography scale + semantic tokens.
- `thumbnail.html` — the design system's homepage tile.
- `components/` — exported React components (see Components below).
- `fonts/` — typography (Google Fonts loaded via CDN; see Type Substitutions below).
- `assets/` — logo lockups, lotus illustration, generic imagery.
- `preview/` — design-system preview cards rendered in the Design System tab.
- `ui_kits/lelanea_app/` — pixel-fidelity recreation of the mobile coaching app with the lotus home, chat, onboarding, journal.

## Components

Every component is exported on `window.LelaneaDesignSystem_a15360` and lives in its own folder under `components/` with a `.d.ts` and a preview card.

| Component | What it is |
|---|---|
| **Lotus** | The signature bloom. Three tiers of broad pointed petals that fan open over 2.2s, then breathe. Props: `size`, `open`, `autoOpen`, `idle`, `water`, `delay`, `onOpened`. |
| **LotusMark** | Static lotus glyph for avatars, favicons and inline marks. Props: `size`, `water` — pass `water={false}` under ~40px for a tight crop on the petals. |

On both lotus components `size` is the **rendered width of the bloom**, not of the SVG frame — so the two are interchangeable at the same `size`, in either `water` mode.
| **Button** | Pill button. Variants `primary` (burnt orange), `secondary`, `ghost`, `destructive`. Press scales to 0.98. |
| **Card** | Elevated stone surface with optional lowercase eyebrow, serif title, body and meta line. Supports `dark`. |
| **ChatBubble** | One turn in a sit — `from="ai"` renders stone with the lotus avatar, `from="user"` deep teal, right aligned. |
| **Chip** | Theme/filter tag. `selected` renders heather amethyst; `tone="teal"` marks an active teaching. |
| **Banner** | Quiet system-state banner in `success` / `error` / `warning` / `info`. |

---

## Type substitutions — PLEASE REVIEW

No font files were provided. I've substituted Google Fonts that carry the intended mood:

| Role | Substituted font | Why |
|---|---|---|
| Display / editorial headings | **Instrument Serif** | Contemplative, crafted, slightly literary — fits Unity Consciousness tone. |
| Body + UI | **Hanken Grotesk** | Clean humanist sans, warm, not over-used. |
| Accent / quote italic | **Cormorant Garamond** (italic) | Soft, spiritual serif for pull quotes and invocations. |

Please share Lelanea's actual type specification if one exists — I'll swap and re-tune the scale.

---

## CONTENT FUNDAMENTALS

Copy in Lelanea's App should feel like a soft voice in a quiet room. Never loud. Never salesy. Never "AI-forward."

### Voice

- **Warm, intimate, invitational.** Uses "you" — speaks directly to the client. Rarely uses "we" except when the AI is describing itself as a companion to Lelanea's teachings.
- **First-person for the AI is sparing.** The AI doesn't say "I think" or "As an AI…" — it says "Let's sit with that," "What's underneath?," "Notice what arrives."
- **Grounded, not mystical-performative.** The work is spiritual, but the copy does not stack mystical vocabulary. Words like "presence," "witness," "arrive," "return" appear — not "divine cosmic energy."
- **Questions over answers.** Much of the product's language is in questions. Coaching, not lecturing.

### Casing

- **Sentence case** for UI labels, buttons, nav, and body. Never all-caps shouting. Never Title Case on buttons.
- **Display headings** may use an Editorial Sentence Case (first word + proper nouns capitalized).
- Tiny eyebrow labels above sections may be lowercase tracked-out (e.g. `a place to return to`).

### Punctuation

- **Em dashes** are welcome — they give the copy breath.
- **Ellipses** used sparingly, only where a pause is genuinely intended…
- **No exclamation points.** None. Ever. Even "Welcome!" becomes "Welcome."
- Periods optional on single-line UI labels.

### Person

- AI → user: **"you."** Never "the user."
- Lelanea's teachings are referenced in third person: **"Lelanea's practice of return,"** not "my practice."
- Community/collective framing: **"the work,"** **"this practice,"** **"what arises."**

### Emoji and ornaments

- **No emoji.** Ever. Emoji are too loud for this product.
- **Unicode glyphs sparingly** — a single lotus mark (✦ or a custom lotus SVG) is the only decorative mark.
- **Pull quotes** set in Cormorant italic with a small lotus glyph above.

### Examples

**Onboarding greeting**
> Welcome. Take a slow breath. When you're ready, the lotus will open.

**Empty-state chat**
> What would you like to bring in today?

**Error state**
> Something didn't land. Try that once more.

**Session end**
> Rest here for a moment before you go.

**Session summary**
> You returned to the body three times today. Notice that.

**Button labels**
- `Begin` (not "Start Now")
- `Return` (not "Back")
- `Close` (not "Dismiss")
- `Sit with this` (a signature CTA on reflection prompts)

---

## VISUAL FOUNDATIONS

### Color

A warm, earthy palette tempered by meditative blues. The **rustic burnt orange** (`#C96F43`) acts as the ceremonial accent — used for the lotus center, the primary CTA, and very little else. The **deep teal** (`#17718A`) and **light aqua** (`#7CC0D6`) are the lotus petals and live in navigation, active states, and iconography. Backgrounds lean oyster white (light) and near-black charcoal (dark) — never pure white or pure black.

Full token list is in `colors_and_type.css` and in the preview cards.

### Typography

- **Display (Instrument Serif):** used for hero moments, section headers, and single-sentence prompts. Set tight — `line-height: 1.05`, `letter-spacing: -0.02em`. Generous size contrast: display wants to be 40–72px.
- **Body (Hanken Grotesk):** 16px base, `line-height: 1.6`. Weights 400 / 500 / 600. Never bolder than 600.
- **Italic (Cormorant Garamond italic):** for pull quotes, session prompts, invocations. Feels like Lelanea's own voice on the page.
- **Numerics:** tabular where alignment matters (streaks, session minutes).

### Spacing

8-point base scale: `4, 8, 12, 16, 24, 32, 48, 64, 96, 128`. Interfaces prefer the larger end — let things breathe. Minimum 24px gutters on phone; 16px only for tight inline groupings.

### Backgrounds

- **Never full-bleed photography.** Imagery is a gesture, never a takeover.
- **Flat color backgrounds** (oyster white / charcoal) with occasional **radial halation** behind the lotus — a very soft aqua-to-oyster radial gradient, ~600px diameter, 8% opacity max.
- **No repeating patterns.** No grain overlay on surfaces.
- **No hard gradients on UI elements.** Gradients only on the lotus itself and its halation.

### Animation

- **Easing:** custom cubic-bezier `cubic-bezier(0.22, 0.61, 0.36, 1)` — a gentle, breath-like ease-out. Named `--ease-breath`.
- **Durations:** 200ms for micro (taps), 420ms for transitions, 1200–2400ms for ceremonial moments (lotus opening).
- **Fades over slides.** Opacity transitions preferred over translate. When translate is used, 4–8px max.
- **No bounces.** No springs. No overshoot. The product breathes; it does not perform.
- **The lotus opens once per session** and becomes ambient (a slow idle breath) after.

### Hover states (web/desktop adjunct)

- Backgrounds deepen by ~6% (light mode) or lighten by ~6% (dark mode) — never a different hue.
- Text links: underline appears (1px, offset 3px). No color change.
- Primary orange button on hover: `#B5633B` (the burnt orange dimmed, not brightened).

### Press states

- `transform: scale(0.98)` with 120ms `--ease-breath`.
- Background flattens one more step. No color shift.

### Borders

- Hairline 1px borders in `#6F7376` at 24% alpha on light mode, 32% alpha on dark.
- Radii: **12px** default, **20px** for cards, **999px** for pills and the lotus CTA.
- No hard corners anywhere (except full-bleed sections, which have no corners).

### Shadows / elevation

The system uses **two elevation layers only.**

- `--shadow-rest` — `0 1px 2px rgba(17, 24, 26, 0.04), 0 2px 6px rgba(17, 24, 26, 0.04)` — for resting cards.
- `--shadow-lift` — `0 8px 24px rgba(17, 24, 26, 0.08), 0 2px 8px rgba(17, 24, 26, 0.04)` — for modals and the active lotus halo.

Inner shadows are not used. Colored shadows are not used except on the lotus center, which casts a very soft orange bloom.

### Protection gradients vs capsules

- **Capsules preferred.** Floating controls sit in solid-color capsules with `--shadow-rest` — not in gradient scrims.
- A **single exception:** chat input at the bottom of the screen uses a protection gradient (oyster white → transparent, 64px) above it so scrolling text fades into the capsule.

### Layout rules

- **Fixed elements:** top status, top nav (if any), bottom chat input, bottom tab bar. Everything else scrolls.
- **Single-column on mobile**, max content width 560px on larger surfaces.
- **Safe area insets respected** top and bottom.
- **Scroll snapping** on the session carousel only.

### Transparency and blur

- Backdrop blur (`backdrop-filter: blur(20px) saturate(140%)`) on **two surfaces only**: the top status bar over scrolling content, and the chat input capsule.
- No frosted-glass cards. No translucent modal backgrounds (use solid surfaces with a dim scrim).

### Imagery vibe

- **Warm, naturally lit, earthy.** If photography is ever shown: linen, clay, dried flowers, morning light, hands, water. No stock-business imagery. No people mid-yoga-pose.
- **Desaturated by ~10–15%.** Never hyper-saturated.
- **No grain overlays.**
- Prefer **illustration** (the lotus) to photography in-product.

### Cards

- Surface: `--surface` (`#EBE6DF` light / `#3A3F42` dark).
- Radius: 20px.
- Shadow: `--shadow-rest`.
- No border by default. Border appears only on dark mode at 8% alpha to separate from the near-black background.
- Internal padding: 20–24px.

### Iconography

See `ICONOGRAPHY` section below.

---

## ICONOGRAPHY

Lelanea's App uses a **small, intentional icon set** — icons should feel like small drawings, not wayfinding glyphs.

### System

- **Lucide** is used as the CDN baseline icon family (linked via `https://unpkg.com/lucide-static@latest`). Lucide's 1.5px stroke, rounded line caps, and open geometry match the contemplative tone.
- **FLAG TO USER:** I substituted Lucide as the closest CDN match. If Lelanea has a custom icon set, please share it and I'll swap.
- **Stroke weight:** `1.5px`. Never filled. Never bicolor.
- **Color:** inherits from text — typically `--fg-secondary` at rest, `--teal-deep` when active.
- **Sizes:** 16, 20, 24. 24 is default. Never smaller than 16.

### Custom marks

- **Lotus mark** (`assets/lotus-mark.svg`) — the brand glyph. Used as:
  - Favicon / app icon center.
  - A small 16px mark above pull quotes.
  - The idle state of the home-screen animation (before it opens).
- **Logo lockup** (`assets/logo-wordmark.svg`) — lotus mark + "Lelanea" set in Instrument Serif.

### Emoji and unicode

- **Emoji: never.**
- **Unicode ornaments:** the thin-space bullet `·` is allowed in meta text (e.g. `4 min · yesterday`). A single lotus glyph `✦` may be used as a poetic divider if the SVG lotus mark can't render.

---

## Lotus animation

The home screen runs the lotus-opening animation. The shared component lives at `components/Lotus/Lotus.jsx`; the app kit's local copy is `ui_kits/lelanea_app/lotus-figure.jsx`, and a standalone demo is at `assets/lotus-opening.html`.

- **Geometry:** three tiers of broad pointed petals radiating from one base point at (160, 175) in the `58 72 204 132` viewBox. Measured 134 × 118 user units, aspect 1.14 — a wide fan, deliberately a little wider than tall so it never reads as a tall spike. All three tiers fan out broadly, so the bright crown itself is wide rather than the width coming only from a dark skirt.
- **Outer tier:** 6 petals, deep teal (`#17718A`), length 60 × width 48, at ±66°, ±46°, ±25°.
- **Mid tier:** 6 petals, mid teal (`#3E96AE`), length 78 × width 50, at ±42°, ±26°, ±11°.
- **Inner tier:** 5 petals, light aqua (`#7CC0D6`), length 98 × width 52, at ±30°, ±15°, 0° — with pale center veins.
- **Core:** burnt orange (`#C96F43`) radial gradient with a soft bloom shadow.
- **Ripples:** three concentric sage rings (`#457B6A` → `#6FA88F`) centred under the bloom, fading outward — stillness on water rather than foliage. They expand into place as the bloom opens. Pass `water={false}` to crop tight to the petals for small marks.
- **Opening:** 2200ms. Petals rotate from a near-upright cluster (18% of rest angle, 0.34 scale) out to rest, staggered inner-to-outer.
- **Idle (post-open):** 4s breath — scale 1.0 ↔ 1.015 on the whole bloom.
