import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

import { BRAND } from '@/lib/brand';

/**
 * Lelañea's email chrome — the frame every leaf-owned auth email renders inside.
 *
 * The lotus, the wordmark, the oyster ground and the legal line, so a message
 * from Lelañea looks like one wherever it lands. Templates put their own words
 * in `children`; this file owns nothing but the surround, which is what keeps
 * two templates from drifting into two brands.
 *
 * ## The colours are the brand tokens, written out
 *
 * Email has no `var()`, so the values from `app/brand-theme.css` are copied
 * here by name — `--color-background`, `--color-popover`, `--color-heading`,
 * `--color-foreground`, `--color-muted-foreground`, `--color-primary`,
 * `--color-primary-foreground`, `--color-divider` — and the dark set beside
 * them for the clients that honour `prefers-color-scheme`. A change to the
 * theme is a change here too; the test pins the light values to the CSS so
 * the two cannot drift apart unnoticed.
 *
 * ## Dark mode, honestly
 *
 * Apple Mail and Outlook honour the media query in `<Head>`; Gmail ignores it
 * and inverts on its own. So the query is a courtesy, and the real guarantee is
 * the palette: no pure white on pure black anywhere, so an inverted render is
 * still readable, and the lotus is a transparent PNG so it sits on either
 * ground. `color-scheme` in the head tells the clients that ask that both are
 * intended.
 *
 * ## The lotus is a PNG, not the SVG
 *
 * `public/lotus-mark.svg` is the mark everywhere else; Gmail strips `<svg>`
 * and blocks SVG `<img>` sources, so `public/lotus-mark.png` is rendered from
 * it at 2× for retina. It is referenced by absolute URL from `baseUrl` because
 * an email has no origin of its own.
 *
 * ## No custom font
 *
 * The product's display serif does not load in email; the wordmark falls to
 * Georgia, which is what the brand's own `--font-serif` stack falls to.
 */

/** Light values, from `app/brand-theme.css`. Pinned by the test. */
export const EMAIL_PALETTE = {
  background: '#f3f0ec',
  card: '#f7f5f1',
  heading: '#11181a',
  foreground: '#282c2e',
  muted: '#5a5f62',
  primary: '#a85732',
  primaryForeground: '#f3f0ec',
  divider: 'rgba(111, 115, 118, 0.16)',
} as const;

/** Dark values, from the same file's `.dark` block. Pinned by the test too. */
export const EMAIL_PALETTE_DARK = {
  background: '#282c2e',
  card: '#3d4245',
  heading: '#f3f0ec',
  foreground: '#e3dad1',
  muted: '#a8aeb1',
} as const;

const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const FONT_SERIF = 'Georgia, "Times New Roman", serif';

export interface LelaneaEmailProps {
  /** Inbox preview line — the first thing a person reads, before opening. */
  preview: string;
  /** The app's origin, for the lotus and any link back in. */
  baseUrl: string;
  /** Why this person is receiving this, in one line, for the footer. */
  reason: string;
  children: React.ReactNode;
}

export function LelaneaEmail({ preview, baseUrl, reason, children }: LelaneaEmailProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{`
          @media (prefers-color-scheme: dark) {
            .lelanea-ground { background-color: ${EMAIL_PALETTE_DARK.background} !important; }
            .lelanea-card { background-color: ${EMAIL_PALETTE_DARK.card} !important; }
            .lelanea-heading { color: ${EMAIL_PALETTE_DARK.heading} !important; }
            .lelanea-text { color: ${EMAIL_PALETTE_DARK.foreground} !important; }
            .lelanea-muted { color: ${EMAIL_PALETTE_DARK.muted} !important; }
          }
        `}</style>
      </Head>
      <Preview>{preview}</Preview>
      {/*
        The ground is a Section of our own rather than Body's background:
        React Email mirrors Body's inline style onto a wrapping <td> for
        Outlook, and that <td> carries no class, so the dark-mode rule could
        recolour <body> and still leave a light ground painted over it.
      */}
      <Body style={body}>
        <Section style={ground} className="lelanea-ground">
          <Container style={container}>
            <Section style={header}>
              <Img src={`${baseUrl}/lotus-mark.png`} width="72" height="46" alt="" style={lotus} />
              <Text style={wordmark} className="lelanea-heading">
                {BRAND.name}
              </Text>
            </Section>

            <Section style={card} className="lelanea-card">
              {children}
            </Section>

            <Hr style={rule} />
            <Section style={footer}>
              <Text style={footerText} className="lelanea-muted">
                {reason}
              </Text>
              <Text style={footerText} className="lelanea-muted">
                {BRAND.legalName}
              </Text>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}

/* ---------- shared styles the templates reuse, so their type matches ---------- */

export const styles = {
  /** Body copy. */
  text: {
    fontFamily: FONT_SANS,
    fontSize: '16px',
    lineHeight: '26px',
    color: EMAIL_PALETTE.foreground,
    margin: '0 0 16px',
  } satisfies React.CSSProperties,

  /**
   * One authored beat of a `cadence` document — its own line, with the space
   * of a breath below it. Not merged into the paragraph above; that is the
   * document's render note, and it holds in email too.
   */
  beat: {
    fontFamily: FONT_SERIF,
    fontSize: '18px',
    lineHeight: '28px',
    color: EMAIL_PALETTE.heading,
    margin: '0 0 14px',
  } satisfies React.CSSProperties,

  /** The one action. */
  button: {
    fontFamily: FONT_SANS,
    backgroundColor: EMAIL_PALETTE.primary,
    color: EMAIL_PALETTE.primaryForeground,
    fontSize: '16px',
    fontWeight: '600',
    lineHeight: '24px',
    textDecoration: 'none',
    textAlign: 'center' as const,
    display: 'inline-block',
    padding: '12px 28px',
    borderRadius: '999px',
  } satisfies React.CSSProperties,

  buttonRow: {
    textAlign: 'center' as const,
    padding: '8px 0 24px',
  } satisfies React.CSSProperties,

  /** Small print inside the card — the pasted link, an expiry. */
  small: {
    fontFamily: FONT_SANS,
    fontSize: '13px',
    lineHeight: '20px',
    color: EMAIL_PALETTE.muted,
    margin: '0 0 8px',
    wordBreak: 'break-all' as const,
  } satisfies React.CSSProperties,

  link: {
    color: EMAIL_PALETTE.primary,
    textDecoration: 'underline',
  } satisfies React.CSSProperties,

  divider: {
    borderColor: EMAIL_PALETTE.divider,
    margin: '20px 0',
  } satisfies React.CSSProperties,
};

/** A link styled for the card, so templates do not each restate the colour. */
export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={styles.link}>
      {children}
    </Link>
  );
}

const body: React.CSSProperties = {
  fontFamily: FONT_SANS,
  margin: 0,
  padding: 0,
};

const ground: React.CSSProperties = {
  backgroundColor: EMAIL_PALETTE.background,
  padding: '24px 12px',
};

const container: React.CSSProperties = {
  margin: '0 auto',
  maxWidth: '600px',
  width: '100%',
};

const header: React.CSSProperties = {
  textAlign: 'center',
  padding: '12px 0 20px',
};

const lotus: React.CSSProperties = {
  display: 'block',
  margin: '0 auto 6px',
};

const wordmark: React.CSSProperties = {
  fontFamily: FONT_SERIF,
  fontSize: '26px',
  lineHeight: '32px',
  color: EMAIL_PALETTE.heading,
  margin: 0,
};

const card: React.CSSProperties = {
  backgroundColor: EMAIL_PALETTE.card,
  borderRadius: '20px',
  padding: '36px 32px 28px',
};

const rule: React.CSSProperties = {
  borderColor: EMAIL_PALETTE.divider,
  margin: '28px 0 16px',
};

const footer: React.CSSProperties = {
  textAlign: 'center',
  padding: '0 16px',
};

const footerText: React.CSSProperties = {
  fontFamily: FONT_SANS,
  fontSize: '12px',
  lineHeight: '18px',
  color: EMAIL_PALETTE.muted,
  margin: '0 0 6px',
};
