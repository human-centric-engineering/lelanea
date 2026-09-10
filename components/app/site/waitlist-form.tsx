import { Button } from '@/components/app/ui/button';
import { FieldHelp } from '@/components/ui/field-help';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LAUNCH_WINDOW, WAITLIST_ANCHOR } from '@/lib/site/config';

/** The prototype's field label row: label, optional ⓘ, optional "optional". */
const LABEL_ROW = 'flex items-center gap-[7px] text-sm text-foreground';
/** 48px tall and 12px cornered — `rounded-md` is 12px on the consumer surface. */
const FIELD = 'h-12 rounded-md px-4 text-[15px]';

/**
 * The waitlist card, where the home page's hero column ends.
 *
 * ## It is deliberately inert, and says so (B31)
 *
 * The route it will post to, the model behind it, and the admin view of what it
 * collects are t-7 and t-8. Shipping a form that looks live and drops what
 * someone typed would be worse than shipping none: they would believe they had
 * joined. So every entry control is `disabled`, the card carries the
 * prototype's own "opening in small groups" line, and there is no `action` and
 * no `onSubmit` to mislead whoever reads the source either.
 *
 * ## The ⓘ buttons stay live, and that is the whole reason they are not in a
 * disabled `<fieldset>`
 *
 * `<fieldset disabled>` was the first shape here, and it is the tidier one: one
 * attribute, and the browser disables everything inside. It also disables the
 * two help popovers, because they are `<button>`s and a disabled fieldset
 * disables its descendants. That would have hidden the explanation of WHY we
 * ask for someone's reason for coming — from exactly the person deciding
 * whether to trust us with it, during the whole period before the form opens.
 * Nothing would have failed; the ⓘ would simply not have responded.
 *
 * So the `<fieldset>` stays for the grouping and the legend, and `disabled`
 * goes on each entry control instead. The trade is five attributes for a
 * readable promise.
 *
 * B31's three honest options for an affordance whose mechanism does not exist
 * are omit, deliberate stub, or build the mechanism. This is the stub, and the
 * task chose it — the hero is laid out around this card, so omitting it would
 * leave the column short.
 *
 * A disabled form needs no client JavaScript, so this stays a server component;
 * `FieldHelp` brings its own `'use client'` boundary for the popover.
 *
 * ## The controls are the platform's, not a second set
 *
 * `components/ui/input.tsx` and `textarea.tsx` already carry our tokens on a
 * consumer surface — t-18 is what put the measured edge on `--color-input`, and
 * `--radius-md` is 12px here, which is the prototype's corner. So this passes
 * two utilities for the height and the type size and inherits everything else,
 * including the disabled treatment and any upstream accessibility fix.
 *
 * ## The fields are D2's four, not the prototype's two
 *
 * The prototype asks for an email and "What brings you here?". D2 ruled the set
 * afterwards: email (required), name, where they heard about it, and what they
 * would want to achieve (the last three optional). It is the later decision and
 * the one recorded against this feature, so it is what ships. The card's
 * heading, note and closing line are still the prototype's, word for word.
 *
 * @see .context/app/planning/design/lelanea.html — `#waitlist-form`
 */
export function WaitlistForm() {
  return (
    <form
      // `scroll-margin-top` is what keeps the heading clear of the sticky bar
      // when the header's CTA lands here; 78px of bar plus room to breathe.
      className="bg-card mt-[34px] max-w-[540px] scroll-mt-[104px] rounded-xl border border-[var(--color-card-border)] px-8 pt-[30px] pb-7 shadow-[var(--shadow-rest)] max-[620px]:rounded-[22px] max-[620px]:px-5 max-[620px]:pt-[22px] max-[620px]:pb-5"
      id={WAITLIST_ANCHOR}
      noValidate
    >
      <h2 className="text-xl font-medium text-[color:var(--color-heading)]">Join the waitlist</h2>
      <p className="text-muted-foreground mt-1.5 text-[15px]">
        We are opening in small groups from {LAUNCH_WINDOW}. You will hear before anyone else.
      </p>

      <fieldset className="mt-[22px] flex flex-col gap-4">
        {/* What tells a screen-reader user the whole group is unavailable and
            why. `disabled` on its own announces nothing about the reason. */}
        <legend className="sr-only">
          Waitlist sign-up, not open yet. The form opens when the waitlist does.
        </legend>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-email">Your email</label>
          </span>
          <Input
            className={FIELD}
            id="wl-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            disabled
          />
        </div>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-name">Your name</label>
            <span className="text-muted-foreground text-[13px]">optional</span>
          </span>
          <Input
            className={FIELD}
            id="wl-name"
            name="name"
            type="text"
            autoComplete="name"
            disabled
          />
        </div>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-source">Where did you hear about this?</label>
            <FieldHelp title="Where did you hear about this?" ariaLabel="Why we ask this">
              It tells her which of the places she shows up actually reaches people, while there are
              still few enough of you to read one by one. It is never used to sort you into a
              segment.
            </FieldHelp>
            <span className="text-muted-foreground text-[13px]">optional</span>
          </span>
          <Input className={FIELD} id="wl-source" name="source" type="text" disabled />
        </div>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-why">What would you want to achieve?</label>
            <FieldHelp title="What would you want to achieve?" ariaLabel="Why we ask this">
              Lelañea reads these herself. It is how she can tell what the app is getting wrong
              before there are enough of you to measure. It is never used to sort you into a
              segment.
            </FieldHelp>
            <span className="text-muted-foreground text-[13px]">optional</span>
          </span>
          <Textarea
            className="min-h-[78px] resize-y rounded-md px-4 py-3 text-[15px]"
            id="wl-why"
            name="why"
            placeholder="A sentence is enough."
            disabled
          />
        </div>

        <Button type="submit" size="lg" block disabled>
          Join the waitlist
        </Button>
      </fieldset>

      <p className="text-muted-foreground mt-4 text-[13px] leading-[1.55]">
        Your email is used to tell you when a place opens, and for nothing else. No newsletter
        unless you ask for one, and you can remove yourself in one click.
      </p>
    </form>
  );
}
