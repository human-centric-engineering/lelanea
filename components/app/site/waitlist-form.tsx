'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { FieldHelp } from '@/components/ui/field-help';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api/client';
import { WAITLIST_ENDPOINT } from '@/lib/app/waitlist/endpoint';
import { LAUNCH_WINDOW, WAITLIST_ANCHOR } from '@/lib/site/config';
import {
  waitlistClientSchema,
  type WaitlistClientInput,
  type WaitlistFormValues,
} from '@/lib/validations/app-waitlist';

/** The prototype's field label row: label, optional ⓘ, optional "optional". */
const LABEL_ROW = 'flex items-center gap-[7px] text-sm text-foreground';
/** 48px tall and 12px cornered — `rounded-md` is 12px on the consumer surface. */
const FIELD = 'h-12 rounded-md px-4 text-[15px]';
/** The card itself, shared by the form and the state that replaces it. */
const CARD =
  'bg-card mt-[34px] max-w-[540px] scroll-mt-[104px] rounded-xl border ' +
  'border-[var(--color-card-border)] px-8 pt-[30px] pb-7 shadow-[var(--shadow-rest)] ' +
  'max-[620px]:rounded-[22px] max-[620px]:px-5 max-[620px]:pt-[22px] max-[620px]:pb-5';

/** A field's inline error, in the prototype's own red-ink note style. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="text-[13px] leading-[1.5] text-[color:var(--color-status-red-ink)]" id={id}>
      {message}
    </p>
  );
}

interface WaitlistResponse {
  message: string;
}

/**
 * The waitlist card, where the home page's hero column ends — now live (t-7).
 *
 * ## It was a deliberate stub until this task, and this is what changed
 *
 * t-5 shipped it disabled, because the route, the model and the admin view did
 * not exist and a form that accepts an email and drops it is worse than no form
 * (`B31`). All three now exist: this posts to `POST /api/v1/app/waitlist`,
 * which writes `AppWaitlistEntry`. The `disabled` attributes and the "not open
 * yet" legend are gone, and the ⓘ popovers stay live for the reason they always
 * did.
 *
 * ## Two error registers, because there are two different failures
 *
 * A bad email is the reader's to fix, and the message is the prototype's own
 * line under the field: "That email address does not look complete. Check it and
 * try once more." A request that fails is not theirs to fix, and it gets the
 * design guide's row for *submission failed* — "Something didn't land. Try that
 * once more." — as an error `Banner`, which carries `role="alert"`.
 *
 * Collapsing the two into one message was the first shape, and it tells someone
 * with a perfectly good address that their address is wrong.
 *
 * ## The success state replaces the card, and says so out loud
 *
 * The prototype swaps the card's contents for an eyebrow, a serif line and a
 * note naming the address. Doing that in React means the form's heading is gone
 * from under a screen reader mid-interaction, so the replacement is a
 * `role="status"` region that takes focus — otherwise the visible outcome of the
 * only action on the page is announced to nobody.
 *
 * **The prototype's fourth element, a "Look inside the app" button to `#/app`,
 * is deliberately absent.** `/app` is behind the auth gate
 * (`lib/app/protected-routes.ts`), and the app is not open, so it would send
 * someone who has just been told to rest for a moment to a login they cannot
 * complete. That is `B31`'s dishonest fourth option — an affordance that looks
 * like the thing and does something adjacent — so it is omitted rather than
 * stubbed.
 *
 * ## The fields are D2's four, not the prototype's two
 *
 * The prototype asks for an email and "What brings you here?". D2 ruled the set
 * afterwards: email (required), name, where they heard about it, and what they
 * would want to achieve (the last three optional). The card's heading, note and
 * closing line are still the prototype's, word for word.
 *
 * @see .context/app/planning/design/lelanea.html — `#waitlist-form`
 * @see app/api/v1/app/waitlist/route.ts · lib/validations/app-waitlist.ts
 */
export function WaitlistForm() {
  const [joinedEmail, setJoinedEmail] = useState<string | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);

  // Three generics, not one: the values the form HOLDS, the context, and the
  // values the resolver PRODUCES. `optionalText` transforms a blank to
  // `undefined`, so the schema's input and output types differ, and collapsing
  // them into a single `z.infer` is a resolver assignment error rather than a
  // convenience — see `WaitlistFormValues`.
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<WaitlistFormValues, unknown, WaitlistClientInput>({
    resolver: zodResolver(waitlistClientSchema),
    mode: 'onTouched',
    defaultValues: { email: '', name: '', heardFrom: '', intent: '', website: '' },
  });

  useEffect(() => {
    if (joinedEmail) confirmationRef.current?.focus();
  }, [joinedEmail]);

  const onSubmit = async (values: WaitlistClientInput) => {
    setSubmitFailed(false);
    try {
      await apiClient.post<WaitlistResponse>(WAITLIST_ENDPOINT, { body: values });
      // The address is echoed back from what was typed, not from the response —
      // the route answers with one fixed sentence on purpose, so that it cannot
      // be used to ask whether a given address is already on the list.
      setJoinedEmail(values.email.trim());
    } catch {
      // Every failure reads the same here — a 429, a 500 and an offline browser
      // are all "it did not land, try again". The one case that would deserve
      // its own message is a rejected email, and the resolver has already
      // caught that before a request is made.
      setSubmitFailed(true);
    }
  };

  if (joinedEmail) {
    return (
      <div className={CARD} id={WAITLIST_ANCHOR} ref={confirmationRef} role="status" tabIndex={-1}>
        <Eyebrow as="p">you are on the list</Eyebrow>
        <p className="brand-display mt-3 text-[30px] leading-[1.25]">
          Thank you. Rest here for a moment before you go.
        </p>
        <p className="text-muted-foreground mt-[14px] text-[15px] leading-[1.65]">
          We will write to {joinedEmail} when a place opens. Nothing else will arrive from us in the
          meantime.
        </p>
      </div>
    );
  }

  return (
    <form
      // `scroll-margin-top` is what keeps the heading clear of the sticky bar
      // when the header's CTA lands here; 78px of bar plus room to breathe.
      className={CARD}
      id={WAITLIST_ANCHOR}
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <h2 className="text-xl font-medium text-[color:var(--color-heading)]">Join the waitlist</h2>
      <p className="text-muted-foreground mt-1.5 text-[15px]">
        We are opening in small groups from {LAUNCH_WINDOW}. You will hear before anyone else.
      </p>

      {/* Honeypot: off-screen and hidden from assistive technology, so only a
          bot filling every input reaches it. `tabIndex={-1}` keeps it out of the
          keyboard order for anyone navigating without a mouse. */}
      <div aria-hidden="true" className="absolute -left-[9999px] opacity-0">
        <label htmlFor="wl-website">Website (leave blank)</label>
        <input
          autoComplete="off"
          id="wl-website"
          tabIndex={-1}
          type="text"
          {...register('website')}
        />
      </div>

      <fieldset className="mt-[22px] flex flex-col gap-4">
        <legend className="sr-only">Join the waitlist</legend>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-email">Your email</label>
          </span>
          <Input
            aria-describedby={errors.email ? 'wl-email-error' : undefined}
            aria-invalid={errors.email ? true : undefined}
            autoComplete="email"
            className={FIELD}
            disabled={isSubmitting}
            id="wl-email"
            placeholder="you@example.com"
            type="email"
            {...register('email')}
          />
          <FieldError id="wl-email-error" message={errors.email?.message} />
        </div>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-name">Your name</label>
            <span className="text-muted-foreground text-[13px]">optional</span>
          </span>
          <Input
            aria-describedby={errors.name ? 'wl-name-error' : undefined}
            aria-invalid={errors.name ? true : undefined}
            autoComplete="name"
            className={FIELD}
            disabled={isSubmitting}
            id="wl-name"
            type="text"
            {...register('name')}
          />
          <FieldError id="wl-name-error" message={errors.name?.message} />
        </div>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-source">Where did you hear about this?</label>
            {/* Each trigger names ITS OWN field. Both said "Why we ask this",
                which gives a screen-reader user two identically named buttons
                on one page and no way to tell which field either belongs to —
                the distinguishing text is in the popover, announced only after
                activation. */}
            <FieldHelp
              ariaLabel="Why we ask where you heard about this"
              title="Where did you hear about this?"
            >
              It tells her which of the places she shows up actually reaches people, while there are
              still few enough of you to read one by one. It is never used to sort you into a
              segment.
            </FieldHelp>
            <span className="text-muted-foreground text-[13px]">optional</span>
          </span>
          <Input
            aria-describedby={errors.heardFrom ? 'wl-source-error' : undefined}
            aria-invalid={errors.heardFrom ? true : undefined}
            className={FIELD}
            disabled={isSubmitting}
            id="wl-source"
            type="text"
            {...register('heardFrom')}
          />
          <FieldError id="wl-source-error" message={errors.heardFrom?.message} />
        </div>

        <div className="flex flex-col gap-[7px]">
          <span className={LABEL_ROW}>
            <label htmlFor="wl-why">What would you want to achieve?</label>
            <FieldHelp
              ariaLabel="Why we ask what you would want to achieve"
              title="What would you want to achieve?"
            >
              Lelañea reads these herself. It is how she can tell what the app is getting wrong
              before there are enough of you to measure. It is never used to sort you into a
              segment.
            </FieldHelp>
            <span className="text-muted-foreground text-[13px]">optional</span>
          </span>
          <Textarea
            aria-describedby={errors.intent ? 'wl-why-error' : undefined}
            aria-invalid={errors.intent ? true : undefined}
            className="min-h-[78px] resize-y rounded-md px-4 py-3 text-[15px]"
            disabled={isSubmitting}
            id="wl-why"
            placeholder="A sentence is enough."
            {...register('intent')}
          />
          <FieldError id="wl-why-error" message={errors.intent?.message} />
        </div>

        {submitFailed ? (
          <Banner lead="Something didn't land." tone="error">
            Try that once more.
          </Banner>
        ) : null}

        <Button block disabled={isSubmitting} size="lg" type="submit">
          {isSubmitting ? 'Joining…' : 'Join the waitlist'}
        </Button>
      </fieldset>

      <p className="text-muted-foreground mt-4 text-[13px] leading-[1.55]">
        Your email is used to tell you when a place opens, and for nothing else. No newsletter
        unless you ask for one, and you can remove yourself in one click.
      </p>
    </form>
  );
}
