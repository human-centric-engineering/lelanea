import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

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
  external,
  newTab,
  children,
}: {
  href: string;
  title: string;
  /**
   * Render a plain `<a>` rather than a `<Link>`.
   *
   * Required for the export row, and not a style preference: `<Link>`
   * prefetches, and the thing behind that href is a GDPR Art. 15 export that
   * reads about twenty-eight tables and has its own rate-limit bucket. A
   * prefetch would run a full export because the row scrolled into view, and
   * could spend the reader's allowance before they clicked anything.
   */
  external?: boolean;
  /** Open in a new tab, so a failure response cannot replace the shell. */
  newTab?: boolean;
  children: React.ReactNode;
}) {
  const Component = external ? 'a' : Link;
  return (
    <Component
      href={href}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
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
    </Component>
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
 * The data-rights rows point at whatever works TODAY, which turns out to be two
 * different places: erasure has a form on the settings page, and subject access
 * has no UI at all — only `GET /api/v1/users/me/export`, which the export row
 * therefore links to directly. They are §06 `f-gateway` t-3's to own and this
 * view is where they will surface; until then the honest thing is to send
 * someone to the control that works rather than to the page where a control
 * like it happens to live.
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
          Straight at the endpoint, because there is no UI in front of it. The
          account settings tab carries the delete form and account facts and
          nothing else — `/data` describes the right but does not exercise it,
          and the only subject-access surface in the tree is this route. It
          answers with `Content-Disposition: attachment`, so a plain link
          downloads the file; pointing this row at the settings page instead
          would have been a row that led nowhere, on an Art. 15 control.
        */}
        {/*
          `target="_blank"` is about the FAILURE, not the success. On a 2xx the
          `Content-Disposition: attachment` cancels the navigation and nothing
          opens. But the route answers a rate-limit refusal — and anything
          thrown inside `exportUserData()` — as a bare JSON envelope with no
          disposition header, and same-tab that commits: raw JSON replaces the
          whole app and the back button is the only way home. In a new tab the
          shell is still behind it.
        */}
        <RowLink
          href="/api/v1/users/me/export"
          title="Export a copy of everything held about you"
          external
          newTab
        >
          Downloads everything held about you as a file, whenever you ask. A more readable version
          of it comes with the rest of your data controls.
        </RowLink>
        <RowLink href="/settings?tab=account" title="Close your account and erase it">
          Everything derived from your work goes with it. Handled in your account settings.
        </RowLink>
      </Section>
    </>
  );
}
