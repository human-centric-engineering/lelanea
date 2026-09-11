import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Eyebrow } from '@/components/app/ui/eyebrow';
import { cn } from '@/lib/utils';

export interface AccountViewProps {
  /** The name on the account, or the email when no name was ever given. */
  name: string;
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
 * The data-rights rows point at the same platform settings for now. They are
 * §06 `f-gateway` t-3's to own — this view is where they will surface, and
 * until they exist the honest thing is to send someone to the controls that DO
 * work rather than to show them a row that does not.
 */
export function AccountView({ name, email, joined }: AccountViewProps) {
  return (
    <>
      <Section label="who you are here">
        <dl
          className={cn(
            'bg-background grid gap-x-6 gap-y-3 rounded-lg border',
            'border-[var(--color-card-border)] px-[22px] py-5',
            'sm:grid-cols-[auto_1fr]'
          )}
        >
          <dt className="text-muted-foreground text-[13px]">Name</dt>
          <dd className="text-[var(--color-heading)]">{name}</dd>
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
        <RowLink href="/settings" title="Password and sign-in">
          Change your password, or see how you signed in.
        </RowLink>
      </Section>

      <Section label="your data">
        <RowLink href="/settings?tab=account" title="Export a copy of everything held about you">
          Readable, whenever you ask. Handled in your account settings for now.
        </RowLink>
        <RowLink href="/settings?tab=account" title="Close your account and erase it">
          Everything derived from your work goes with it. Also in your account settings.
        </RowLink>
      </Section>
    </>
  );
}
