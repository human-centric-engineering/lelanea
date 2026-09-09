# The Lelañea design prototype

I'm attaching `lelanea.html` — the approved design prototype for Lelañea. It's
also published at
https://claude.ai/code/artifact/cfdc35ca-bd79-4377-90df-ab97c4fe9ee4 if you can
open it; if not, the attached file is authoritative — read it directly.

It's a single self-contained HTML/CSS/JS file covering two surfaces:

- **the public site** — nav, hero with the lotus mark, waitlist form, "what this
  is / what this is not", tiers, quote bands, footer;
- **the signed-in app** — a four-column shell (left nav, the conversation, the
  workspace, and a right rail whose buttons open drawers), plus the journey view,
  module views, situations, resources, usage and billing, settings, account.

**Treat it as the reference for how the product looks and behaves:** layout and
information architecture, the palette in both light and dark, the type (Instrument
Serif for headings, Hanken Grotesk for body, Cormorant Garamond italic for
quotes), the motion, and the interaction behaviours — how panes resize and
collapse, how drawers open over the content, how the navigator shows what's done
and what's current.

**Also use it as the source of our initial content.** The public-site copy is
real and considered — reuse it as written. Inside the app it's a skeleton on
purpose: the structure and the module names are real, the module bodies are
deliberately placeholders, so don't mistake them for finished content.

Two things to keep in mind: it's a prototype, not production code — we'll build
it on a different stack, so it's a look-and-behave spec rather than an
implementation. And where it disagrees with the product description in this
project, flag it rather than quietly picking one.

When we plan the build, I want the theming and the layout shell to come early,
ahead of feature work, so we have something visual to work against.
