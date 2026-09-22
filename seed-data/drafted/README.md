# Drafted seed data: not Lelañea's words

Every file here was drafted _for_ Lelañea Fulton, not written by her. Some were
drafted from her six files in `content/`; others were drafted from the product
description. Each one is a proposal until she signs it off, and each carries a
`provenance` block saying so.

- `lelanea_voice_fingerprint.json`: the always-on core of her voice
- `lelanea_voice_overlays.json`: the register overlays for particular moments
- `lelanea_voice_golden_set.json`: the prompts her voice is heard through
- `lelanea_crisis_resources.json`: the crisis copy and helplines, by region
- `lelanea_slot_taxonomy.json`: what the guide may remember about a person
- `lelanea_resources.json`: the films, readings and words per module

These files are seed input: the seeds in `prisma/seeds/app-lelanea/` write them
to the database. The crisis resources and the slot taxonomy are already edited in the
admin once seeded; §22 brings the rest there. See `.context/app/content.md`.
