# Lelanea App — UI Kit

Pixel-fidelity recreation of the Lelanea coaching app for mobile (iOS).

## Files

- `index.html` — interactive click-thru shell. Switches between onboarding, home (lotus), sit (chat), journal, practices, and profile.
- `lotus-figure.jsx` — animated lotus figure used by the kit (the shared component lives at `components/Lotus/`).- `Primitives.jsx` — shared UI bits: `Eyebrow`, `LotusMark`, `Icon`, `Pill`, `TabBar`.
- `Screens.jsx` — the five screens plus onboarding. Each takes `onNav(route)`.
- `ios-frame.jsx` — iOS device bezel.

## Screens covered

| Route | What it shows |
|---|---|
| `onboarding` | First launch — lotus mark, poetic welcome, "Begin" CTA. |
| `home` | Lotus opens, then the greeting fades in with "Begin a sit". |
| `sit` | 1:1 chat with the AI. Warm stone bubbles on left, deep teal on right, burnt-orange send. |
| `journal` | Stone cards of saved reflections. Editorial serif titles. |
| `practice` | Theme-tagged short practices. Lotus-framed thumbnails. |
| `you` | Streaks/stats in Instrument Serif, settings in inset cards. |

## Design notes

- **The lotus opens only once per launch**, then breathes ambiently (`scale 1 ↔ 1.015` over 4s). Navigating away and back does not retrigger the open.
- **Top of Sit** uses a protection gradient over scrolling chat, not an opaque bar.
- **Tab bar** is a floating pill with backdrop blur — only the active tab shows its label.
- **No emoji, no stock illustrations.** The only visual ornament is the lotus.
