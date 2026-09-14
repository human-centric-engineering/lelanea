import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ExportDataRow } from '@/components/app/account/export-data-row';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { cn } from '@/lib/utils';

/**
 * The line under the title, exported because the loading state renders it too.
 *
 * Not a style preference: the skeleton's bars have to sit on the same lines as
 * the content that replaces them, and the lede is what puts them there. Two
 * hardcoded copies would drift the first time one was edited, silently, with
 * nothing failing.
 */
export const ACCOUNT_LEDE = 'What Lelañea knows about you here, and where to change it.';

export interface AccountViewProps {
  /**
   * The name on the account, or `null` when none was ever given.
   *
   * Nullable rather than falling back to the email, because the row is labelled
   * "Name" and this view's whole claim is that it shows only what the session
   * actually holds. `Name — maya@example.com` asserts a fact the system does
   * not have. The PAGE still titles itself with the email in that case, which
   * is a stand-in for a heading rather than an answer to a labelled field.
   */
  name: string | null;
  email: string;
  /** Already formatted on the server — see the page, and the note below. */
  joined: string;
}

/**
 * One row that leads somewhere, with what it is for underneath it.
 *
 * The prototype's `.rowcard` is a `<button>` that raises a toast. Here every
 * one of them genuinely goes somewhere, so it is a link — which also means the
 * destination is in the status bar, openable in a new tab, and announced as a
 * link rather than as a button that lies about what it does.
 */
function RowLink({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  // A `<Link>`, and safely so: every row here leads to a page. The `external`
  // and `newTab` escape hatches this once carried existed for the export row —
  // a `<Link>` prefetches, and prefetching an Art. 15 export ran it because the
  // row scrolled into view — and went with it when the export became a
  // control (`ExportDataRow`, §06 t-17).
  return (
    <Link
      href={href}
      className={cn(
        'bg-background mb-2 block rounded-[15px] border border-[var(--color-card-border)]',
        'px-[15px] py-[13px] no-underline hover:no-underline',
        'hover:bg-[var(--color-pill-hover)]',
        'transition-[background-color] duration-200 ease-[var(--ease-brand)]',
        'motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
        'focus-visible:outline-[var(--color-ring)]'
      )}
    >
      <span className="flex items-center gap-2 text-[var(--color-heading)]">
        {title}
        <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" className="flex-none" />
      </span>
      <span className="text-muted-foreground mt-1 block text-[13px] leading-[1.55]">
        {children}
      </span>
    </Link>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <Eyebrow as="h2" className="block px-1 pb-2">
        {label}
      </Eyebrow>
      {children}
    </section>
  );
}

/**
 * The account view: who you are here, and where the controls for it live.
 *
 * ## Three facts, and no statistics
 *
 * The prototype's account page carries "Eleven sessions so far" and three
 * counters. Not one of them has anything behind it yet, and a count is the
 * easiest kind of lie to ship because it looks like data rather than like copy
 * (D6). So this view shows only what the session actually knows — the name on
 * the account, the address it belongs to, and when it was opened.
 *
 * `joined` arrives already formatted. Formatting a date in the browser uses the
 * reader's locale and time zone, and the server has neither, so doing it here
 * would produce one string during SSR and possibly another on hydration — a
 * mismatch React resolves by warning and re-rendering, on the one view whose
 * whole job is to be trustworthy about facts.
 *
 * ## Why identity lives behind the platform's own pages
 *
 * Name, password and email are Sunrise's, and `lib/app/protected-nav.ts` was
 * filled in t-9 precisely so `/profile` and `/settings` render with a header
 * that can get back here. Rebuilding those forms inside the shell would be a
 * second place a password can be changed, and the second one is always the one
 * that misses a security fix.
 *
 * ## The two data rights (§06 t-17)
 *
 * They live in two different places, on purpose. Erasure is Sunrise's form on
 * the settings page — typed confirmation, password-gated on the route, routed
 * through `eraseUser()` — and this view links to it rather than building a
 * second erasure path, which is the one thing CLAUDE.md forbids outright.
 * Subject access has no platform UI, only `GET /api/v1/users/me/export`, so
 * the export control is ours: `ExportDataRow`, a button that fetches the
 * bundle and hands it over as a file, answering a refusal in a sentence rather
 * than as a JSON screen.
 */
export function AccountView({ name, email, joined }: AccountViewProps) {
  return (
    <>
      <Section label="who you are here">
        <dl
          className={cn(
            'bg-background grid gap-x-6 gap-y-3 rounded-lg border',
            'border-[var(--color-card-border)] px-[22px] py-5',
            // See `settings-view.tsx`'s `Panel`: that border is transparent in
            // light mode and 8% in dark, so without the resting shadow this
            // has an edge in one theme and a 1.06:1 fill difference in the
            // other.
            'shadow-[var(--shadow-rest)]',
            'sm:grid-cols-[auto_1fr]'
          )}
        >
          {name ? (
            <>
              <dt className="text-muted-foreground text-[13px]">Name</dt>
              <dd className="text-[var(--color-heading)]">{name}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground text-[13px]">Email</dt>
          <dd className="break-all text-[var(--color-heading)]">{email}</dd>
          <dt className="text-muted-foreground text-[13px]">Joined</dt>
          <dd className="text-[var(--color-heading)]">{joined}</dd>
        </dl>
      </Section>

      <Section label="identity and sign-in">
        <RowLink href="/profile" title="Your profile">
          The name and details other parts of Lelañea use.
        </RowLink>
        {/*
          `?tab=security` and not a bare `/settings`. `DEFAULT_SETTINGS_TAB` is
          `profile`, so the bare path lands on a name-and-avatar form with no
          password field anywhere on it — a row whose label and destination
          disagree.
        */}
        <RowLink href="/settings?tab=security" title="Password and sign-in">
          Change your password, or see how you signed in.
        </RowLink>
      </Section>

      <Section label="your data">
        {/*
          §06 t-17. The one control on this page that is not a link: the
          export is an ACTION — a file is produced, nothing is navigated to —
          and `ExportDataRow` says why a fetch beat the link t-11 shipped here.
        */}
        <ExportDataRow />
        {/*
          §06 t-16. The gate page is the record once every acknowledgement
          stands — the three facts, their dates, and a way back to each text —
          and this is the only link to it from inside the shell. Without it the
          gate's own "you can read it back from this page" is true only for
          someone who knows the URL. Above the erasure row: closing the account
          is the last thing on the page, not something in the middle of it.
        */}
        <RowLink href="/app/begin" title="What you agreed to">
          The disclaimer, the terms, and your age confirmation — which version, and when.
        </RowLink>
        {/*
          Sunrise's form: a typed confirmation, and the route asks for the
          password. Quiet here, explicit there. Not rebuilt in the shell — the
          second erasure path is always the one that misses a security fix.
        */}
        <RowLink href="/settings?tab=account" title="Close your account and erase it">
          Everything derived from your work goes with it — your waitlist entry, what you agreed to
          at the gate, all of it. Handled in your account settings, with a confirmation.
        </RowLink>
      </Section>
    </>
  );
}
