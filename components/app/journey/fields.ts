import { cn } from '@/lib/utils';

/**
 * The journey view's field treatment (t-148): the notes controls' card ground,
 * border and focus outline, squared off for fields that hold sentences.
 */
export const FOCUS =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--color-ring)]';

export const FIELD = cn(
  'bg-card w-full rounded-xl border border-[var(--color-border)] px-3 py-2',
  'text-[14px] leading-[1.6] text-[var(--color-heading)] outline-none',
  'placeholder:text-muted-foreground',
  FOCUS
);

export const LABEL = 'text-[12.5px] text-[var(--color-heading)]';
