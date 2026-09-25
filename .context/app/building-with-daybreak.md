# Building with Daybreak: its elements are what Lelañea is made of

**Owner ruling, 25 September 2026.** Daybreak is not an upstream to route
around. It is the scaffolding Lelañea is built from. Its elements (modules,
module config, data slots, agent seats, capabilities, knowledge scopes,
facilitation maps, journeys, guidance) are integral parts of this app, and a
feature is built out of them, following the ethos Daybreak sets. Lelañea
supplies the content, the voice and the product. Daybreak supplies the shape it
takes.

This is not the same as the golden rule in the `CLAUDE.md` banner ("fill the
`leaf-*` seams; don't edit the tiers above you"). That rule is about which
**files** to edit. This one is about what to **build**: a feature uses the
element Daybreak already provides for it.

## Start every feature by naming its Daybreak element

Before designing anything, say which element each part of it is:

| If the thing is…                              | It is a…                                                                                                                   | Seen by an admin in                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A place in the journey                        | **module**: a `ModuleDefinition`, registered in `lib/app/leaf-bootstrap.ts` (`lib/app/modules/definitions.ts`)             | Framework → Modules                             |
| A setting an admin tunes for a module         | the module's **config schema** (`configSchema`), which gets a form, validation and version history for free                | the module's Config and Versions tabs           |
| Something asked of, or learnt about, a person | a **data slot**, declared by the module that captures it (`slotDefinitions`). Global only if it truly belongs to no module | Framework → Data slots                          |
| An agent working in a module                  | a **seat** (`agentRoles`) and a binding                                                                                    | the module's Agents tab                         |
| A tool that agent calls                       | a module **capability** (`capabilities`)                                                                                   | the module's config and the capability registry |
| What the agent may read in a module           | the module's **knowledge scope**                                                                                           | the module's Knowledge tab                      |
| A sequence a person is guided through         | a **facilitation map** or **journey**                                                                                      | Framework → Maps, Journeys                      |

**Content that belongs to a module is owned by that module and visible in its
area** (Framework → Modules → the module). That is the purpose of having
modules. The discovery questions belong to Onboarding, so an admin finds them
there.

## When the element does not fit

Say so, to the owner, before building anything, and name what Daybreak lacks.
The answer is a conversation with Daybreak (an issue on `daybreak`, per the
ownership check in the `CLAUDE.md` banner), not a structure of our own beside
it.

## Anti-patterns

- **A parallel `app_…` table for something a Daybreak element already
  models.** For example, a module's settings held in an app table and edited on
  an app page, when the module's config schema would give them a form, versions
  and a place on the module's page.
- **Treating a gap as a reason to build around Daybreak.** Carrying a seam
  ahead of Daybreak (`divergences.md`) is a last resort the owner rules on, not
  the first answer to "Daybreak's page does not show our thing".
- **An app-only admin page for module content.** If it belongs to a module, it
  lives in that module's area.
