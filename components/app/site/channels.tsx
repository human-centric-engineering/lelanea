import { ChannelGlyph } from '@/components/app/site/channel-icons';
import { ImagePlaceholder } from '@/components/app/site/image-placeholder';
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
 * `/lelanea`. The art panel is a placeholder until the cover art is supplied.
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
            <ImagePlaceholder title={channel.art} className={styles.channelArt} />
            <div className={styles.channelBody}>
              <h3 className={styles.channelName}>
                <ChannelGlyph icon={channel.icon} size={18} />
                <span className="brand-display">{channel.name}</span>
              </h3>
              <ul className={styles.channelLinks}>
                {channel.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      rel="noopener noreferrer"
                      target="_blank"
                      aria-label={`${channel.name} on ${link.label} (opens in a new tab)`}
                    >
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
              <ChannelGlyph icon={link.icon} size={20} />
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
