'use client';

import { Play } from 'lucide-react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Button } from '@/components/app/ui/button';

/**
 * The two actions under a module: the one that works, and the one that says
 * why it does not yet.
 *
 * "In Lelañea's own words" opens the resources drawer, which follows the open
 * module on its own (`resources-drawer.tsx` reads the route), so the button
 * passes nothing — a plain `openDrawer('resources')` lands on her words on
 * this module, two videos and three articles chosen for it. "Talk about this
 * part" needs the conversation, which arrives in a later phase; it is
 * `disabled` with the same reason the composer gives, so the two surfaces never
 * disagree about why.
 */
export function ModuleActions() {
  const { openDrawer } = useShellLayout();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => openDrawer('resources')}
        className="gap-2"
      >
        <Play size={14} strokeWidth={1.5} aria-hidden="true" />
        In Lelañea’s own words
      </Button>
      <Button
        type="button"
        size="sm"
        disabled
        title="Talk about this part — arrives with the conversation"
        aria-label="Talk about this part — arrives with the conversation"
      >
        Talk about this part
      </Button>
    </div>
  );
}
