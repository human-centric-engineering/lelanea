import Image from 'next/image';

import { LinkMark } from '@/components/app/site/service-logos';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { CREATOR_LINKS, SITE_CHANNELS } from '@/lib/site/config';
import styles from '@/components/app/site/atmosphere.module.css';

/** The arrow every outbound link ends with: it leaves the site. */
function OutArrow() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" />
    </svg>
  );
}

/**
 * Her work beyond the app, as the home page shows it (t-171).
 *
 * One card per thing she makes, each with the places to find it. No card
 * describes its subject: the owner's ruling is that the public site says
 * nothing about her work that she did not, and her own account of it is on
 * `/lelanea`. The art is hers, from where each thing is published.
 *
 * Each link names its card in its accessible name, because "YouTube" appears
 * on two cards and a list of links read out of context would not tell them
 * apart.
 */
export function ChannelsSection({ className }: { className?: string }) {
  return (
    <section className={className} aria-labelledby="channels-heading">
      <Eyebrow as="p">her work beyond the app</Eyebrow>
      <h2
        id="channels-heading"
        className="brand-display my-[14px] mb-[26px] text-[clamp(32px,3.4vw,40px)]"
      >
        Integrating Consciousness
      </h2>

      <ul className={styles.channels}>
        {SITE_CHANNELS.map((channel) => (
          <li key={channel.name} className={styles.channel}>
            {/* Decorative: the card's heading names what the art is for, and
                the text in the artwork repeats the show's own name. */}
            <div
              className={`${styles.channelArt} ${channel.art.contain ? styles.channelArtMark : ''}`}
            >
              <Image
                src={channel.art.src}
                alt=""
                fill
                sizes="(max-width: 620px) 112px, (max-width: 1100px) 50vw, 25vw"
                style={{
                  objectFit: channel.art.contain ? 'contain' : 'cover',
                  objectPosition: channel.art.position ?? '50% 50%',
                }}
              />
            </div>
            <div className={styles.channelBody}>
              <h3 className={`brand-display ${styles.channelName}`}>{channel.name}</h3>
              <ul className={styles.channelLinks}>
                {channel.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      rel="noopener noreferrer"
                      target="_blank"
                      aria-label={`${channel.name} on ${link.label} (opens in a new tab)`}
                    >
                      <LinkMark mark={link.mark} icon={link.icon} size={15} />
                      {link.label}
                      <OutArrow />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Where to find her, beneath her biography on `/lelanea` (t-171).
 *
 * Placed directly under `about_the_creator` rather than after the lineage: her
 * biography closes on what she publishes and where, so the list continues her
 * own last paragraph instead of restating it somewhere else on the page.
 */
export function CreatorLinks() {
  return (
    <nav aria-label="Where to find Lelañea" className={styles.creatorLinks}>
      <Eyebrow as="p">where to find her</Eyebrow>
      <ul>
        {CREATOR_LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href} rel="noopener noreferrer" target="_blank">
              <LinkMark mark={link.mark} icon={link.icon} size={18} />
              <span className={styles.creatorLinkLabel}>{link.label}</span>
              <span className={styles.creatorLinkDetail}>{link.detail}</span>
              <OutArrow />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
