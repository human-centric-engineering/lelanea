# Lelañea

The product description and everything it references.

Start with `lelanea-product-description.pdf` (or the `.md`, which is the editable
source). Appendix A of that document lists every file here, what it is, and which
sections refer to it.

    lelanea-product-description.md     the product description, editable source
    lelanea-product-description.pdf    the same, typeset for reading

    design/      the approved prototype (lelanea.html), the note on how to read it,
                 and the starter design system. The prototype governs layout,
                 theming, and behaviour; its app copy is deliberate placeholder.

    reference/   the inputs the product description condenses: the technical
                 grounding brief and the framework overview. Context rather than
                 specification.

The six authored JSON files this bundle is built around live at `content/` in the
repo root, where the build can reach them: the foundational documents, the module
structure, the discovery questions, the Values module, the value exploration
framework, and the value explorations themselves. Transcribed from Lelanea
Fulton's own material and corrected only for typography. Not a draft for the
build to improve on.

A seventh file sits beside them and is a different kind of thing:
`lelanea_voice_fingerprint.json`, the always-on core of the voice fingerprint
(§5). It was drafted *from* the six in her register rather than transcribed from
anything she wrote, so it carries a `provenance` block naming her as the person
who has yet to sign it off. Until she has, it is a proposal — the one file here
that is a draft for her to correct.

Nothing reads those files directly. They are validated against Zod schemas and
served through `lib/app/content` and `/api/v1/app/content/*`, so that a native
client later renders the same copy through the same API rather than growing a
second pipeline; an ESLint rule fails any import of `content/*.json` from
outside `lib/app/content/`.

Where these disagree: the product description governs what the product is, what it
says, and its vocabulary. The prototype governs how it looks and behaves. The design
system governs tokens and components. The content files govern anything authored by
Lelanea, which is never paraphrased in the build.

Version 0.3, 21 August 2026.
