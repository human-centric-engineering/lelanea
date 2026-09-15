import { Eyebrow } from '@/components/app/ui/eyebrow';

/**
 * The resources drawer's body: the designed placeholder card, and the section
 * the films will arrive into.
 *
 * ## What this task builds, and what it deliberately does not
 *
 * The chrome and the placeholder. The prototype's panel shows her words in a
 * card, then a `to watch` section of film cards — 16:9 thumbnail, play button,
 * duration pill, title, subtitle — and then `to read`. **The films and the
 * reading are f-resources' work, in phase 3.** So the card and the section
 * structure are here and the list behind them is empty, rather than two invented
 * films with a stock thumbnail on them. That is D6 and `B31`: a placeholder that
 * says what it is beats something that looks finished and is not.
 *
 * It was previously one grey paragraph, which is neither — it did not read as
 * the designed panel and it did not read as a placeholder either.
 *
 * ## Why the card is not `<PlaceholderCard>`
 *
 * The views' placeholder card is a dashed-bordered frame with a `module
 * placeholder` tag on it, for a whole view that has nothing in it yet. This is
 * the prototype's `.words` — a solid card carrying her voice, which is a real
 * piece of the design rather than a stand-in for one. The copy inside it is the
 * thing that is provisional, not the card.
 *
 * ## No per-module following, yet
 *
 * The prototype's lede changes with whatever is open in the workspace (`On 01 ·
 * Values. This follows whatever you have open…`) and picks films to match. That
 * needs a resource library to pick from, so the panel says the general thing
 * until there is one. The drawer's own lede in `drawer.tsx` is written to be
 * true either way.
 */
export function ResourcesDrawerBody() {
  return (
    <div className="flex flex-col gap-4">
      {/* The prototype's `.words`: her voice on the card wash, not on the page. */}
      <div className="rounded-[18px] border border-[var(--color-card-border)] bg-[var(--color-card)] px-5 py-[18px]">
        <p className="brand-quote text-[20px] text-[var(--color-heading)]">
          Everything here is something I would say to you in the room.
        </p>
        <p className="text-foreground mt-3 text-[14.5px] leading-[1.7]">
          The films and the reading arrive with the programme. When they do, what each module points
          at will be here beside it — chosen for where you are, not a library to work through.
        </p>
      </div>

      <section aria-labelledby="resources-to-watch" className="flex flex-col gap-2.5">
        <Eyebrow as="h3" id="resources-to-watch" className="px-0.5">
          to watch
        </Eyebrow>
        {/*
          The empty state, inside the section rather than instead of it. An
          eyebrow with nothing under it reads as something that failed to load;
          this says which it is.
        */}
        <p className="text-muted-foreground px-0.5 text-[13px] leading-[1.6]">
          Nothing to watch yet. Her films land here as the programme opens.
        </p>
      </section>
    </div>
  );
}
