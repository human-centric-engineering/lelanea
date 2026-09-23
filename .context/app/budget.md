# Usage and cost

> **Nothing is charged in release 1**, and the app is straightforward about
> cost anyway (product description §3.20, §6.12). What follows is the member's
> view of what their conversations cost, and the limit that keeps the work
> sustainable while it is free. The card on file, receipts and a budget a
> person sets are the commercial phase's and are **not** built — omitted rather
> than stubbed (`B31`).

## Where the figures come from

**Nothing here meters anything.** Every dollar is read through
`lib/app/agent/metering.ts`, which sums Sunrise's `ai_cost_log` in place — the
read side f-agent t-56 built, documented in [`agent.md`](./agent.md#reading-the-meter).
This feature is the surfaces that read it. Three consequences worth holding on
to before changing anything here:

- **There is no second table of dollars**, and there must not be. A copy is a
  second answer, and the two drift.
- **A total containing `unpricedRows` is a floor**, never an exact figure. `$0`
  is not "free" — it is a model the price registry has no rate for. Everything
  derived from such a total inherits the doubt in the direction that flatters:
  spend reads "at least", what is left reads "at most", and `overCeiling` can
  read false when real spend is past the limit. Nothing can close that last one
  — the price is missing, not wrong — so the panel says plainly that some
  replies had no price on file.
- **The month-to-date aggregate has no `(userId, createdAt)` index**, on
  purpose. `agent.md` records the trigger for revisiting (the query appearing in
  slow-query logs) and the remedy (an upstream request to Sunrise, never a leaf
  migration, `B13`). A by-day chart is the same aggregate shape already in use.

## The member's view — `/app/usage` (t-94)

| Piece                                     | Where                                  |
| ----------------------------------------- | -------------------------------------- |
| The page, guarding its own session        | `app/(lelanea)/app/usage/page.tsx`     |
| The arrangement, and the two reads        | `components/app/usage/usage-panel.tsx` |
| The two bar charts                        | `components/app/usage/plot.tsx`        |
| Every judgement about what a figure means | `lib/app/usage/usage-view.ts`          |
| The browser's side of the read            | `lib/app/usage/usage-client.ts`        |

Three stats — used this month, what is left, the monthly limit — then **By day**
(a bar per day of this UTC month, a dashed average to read the shape against)
and **This week** (seven bars, each printing its own figure). The prototype's
own note says why the two differ: _"One measure, one hue, two time frames. The
month is dense enough to read as a shape and carries no per-bar figures; the
week is seven bars, so each one shows its own."_

**Money, never tokens.** The prototype's rule, and its reason: _"the token
arithmetic is ours to worry about, not yours."_ Tokens appear once in the whole
app — in the account row under a reply, where a person opened the detail.

### One breakdown serves both charts, and it goes second

`fetchUsage()` asks for `GET /api/v1/app/usage`, then one
`GET /api/v1/app/usage/breakdown?by=day&from=…`, where `from` is **whichever is
earlier** of the month's first instant and seven days before the summary's end.
Early in a month the week chart reaches back into the previous one, so a
month-only window would leave it short; one request covers both in about
thirty-seven days at most — inside the API's 366-day bound and its 100-group
default, so neither chart can be silently truncated.

**The order is deliberate, and it costs a round trip.** Both instants come from
the summary, which is the server's. Deriving the start from the device's clock
let the two halves of the page disagree across a day boundary: a device an hour
fast at the turn of a month asked for six days while `monthPlot` still drew
thirty-one, so twenty-five days of real spend rendered as idle zeros beneath a
headline that counted them. Nothing is drawn until both have landed — the panel
shows one skeleton for the pair — so the extra trip costs latency, not a second
render. For the same reason `readingEnd()` takes the chart's END from the
breakdown's window rather than from `new Date()`.

### The gap-filling is the point

A breakdown returns a group **only for a day that has cost rows**. Drawn
straight from the groups, a month with quiet days would close the gaps: the bars
would be adjacent, every date would be wrong, and an idle fortnight would read
as a busy one. `daysBetween()` walks the window and fills every missing day with
zero. A day that spent anything always draws at least a 4%-of-peak bar, because
a bar of no height says nothing happened; a day that spent nothing draws a 3px
sliver, so the axis reads as a run of days rather than as holes.

### Six states that are not errors

| State                                | What is shown                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Nothing spent                        | `$0.00`, no average line (a line at zero pretends to be data), plots that say so in words                           |
| A total with unpriced rows           | "used this month, **at least**", and a sentence naming why                                                          |
| A $0 limit                           | No meter — nothing divides by zero. A sentence: nothing may be spent, everything readable still works               |
| Past the limit                       | A sentence with the reset, in place of the meter                                                                    |
| Spend under a cent, and short        | `less than a cent` — the floor qualifier is **not** prefixed, because "at least less than a cent" is not a sentence |
| Spend under a cent, on a chart label | `<$0.01` — prose four words wide wraps in a 38px column, and a wrapped label shortens its own bar's track           |

The last one matters most. `fractionUsed` goes **above 1** when a person is over
— reachable by design, because the turn that crosses the line completes (t-59's
accepted trade, so a reply is never cut off mid-sentence). `meterFill()` clamps
the **bar** at full while `usageStats().overCeiling` carries the fact that it
should not be. Clamp the number and read the bar as the whole truth, and "over
your limit" silently becomes "exactly at it".

### The limit is read-only, and has no control beside it

Owner ruling, 22 September 2026: **explain and wait.** There is no "ask for
more" because there is no mechanism behind one, and `B31` says not to draw one
([`agent.md`](./agent.md) — "It offers no 'ask for more'"). The absence of a
button is the honest design, not an omission to be filled in later.

### Charts are CSS, not a charting library

`recharts` and `echarts` are both in `package.json` — for
`components/admin/orchestration/costs/`, which is Sunrise's. Nothing under
`components/app/**` uses either, and these plots are flex children with a height
percentage: `--color-bar` and `--color-bar-idle` are already in
`app/brand-theme.css`, and the prototype draws exactly this with a `<div>` per
day. Pulling a charting runtime into a **member** bundle to draw rectangles
would be the larger decision, and it would have been made by accident. Revisit
at the first chart a `<div>` cannot honestly draw (f-budget ruling 1).

Each plot is one `role="img"` carrying what the shape says — the window, the
total, the peak. Thirty-one focusable bars would be thirty-one tab stops between
a person and the rest of the page, and a `<div>` per day announces nothing at
all. The tip is `pointerover`, not `mouseover`, so a tap raises the figure a
hover does.

### `fetch` cannot be called as a method

`options.fetchImpl(url)` makes `this` the options object, and a browser answers
`Failed to execute 'fetch' on 'Window': Illegal invocation`. Every unit test
injects a `fetchImpl`, so **the default path is the one no test takes** — this
survived a green suite and was found by opening the page. `boundFetch()` in
`usage-client.ts` binds it once; the call sites cannot reintroduce it.

## Still to come on this feature

- **t-95** — the spend meter in the topbar. [`shell.md`](./shell.md) has held
  the seam open: "omitted from the topbar rather than faked".
- **t-96** — the `ceiling_reached` ending in her register. Today that frame
  keeps the platform's contract words, which is what `turns.tsx` says it does
  for a code it does not know.
- **t-97** — the first admin cost view, per person and per conversation.
