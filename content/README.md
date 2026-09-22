# content/

These are Lelañea Fulton's words: six files transcribed from her own material
and corrected only for typography.

- `lelanea_foundational_documents.json`: the mission, the about, the app, the
  welcome, the disclaimer, the terms and the data statement
- `lelanea_module_structure.json`: the journey's tiers and modules
- `onboarding_discovery_questions.json`: the thirty discovery questions
- `values_module.json`: the Values module
- `values_reference_framework.json`: the value exploration framework
- `value_explorations.json`: the value explorations

**They are reference and seed input.** The app is built from them and its agents
are informed by them, but the running app should not read them. They are seeded
into the database, and every client is served from there through the API.

**The build never edits them.** Each file is byte-identical to its first commit
(`2953c053`). A correction is hers to make. The `reviewNotes` inside the files
are open questions for her, not instructions to the build.

Nothing else belongs in this folder. Data drafted _for_ her (the voice
fingerprint, the golden set, the crisis resources and so on) lives in
`seed-data/drafted/`, labelled as unsigned proposals. See
`.context/app/content.md`.
