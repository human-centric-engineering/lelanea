/**
 * Call `callback` once `ms` of time with the tab seen has passed. The count
 * stands still while the tab is hidden and carries on, from where it was,
 * when it is seen again — so switching away and back never starts it over.
 *
 * Returns a function that cancels it.
 *
 * @see components/app/shell/entry-bloom.tsx — the cover's backstop
 * @see components/app/ui/dot-lotus.tsx — the flat flower's stand-in opening
 */
export function seenTimeout(callback: () => void, ms: number): () => void {
  let left = ms;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  const fire = () => {
    done = true;
    stop();
    callback();
  };
  const count = () => {
    if (done || timer !== undefined || document.hidden) return;
    since = performance.now();
    timer = setTimeout(fire, left);
  };
  const onVisibility = () => {
    if (!document.hidden) return count();
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    left = Math.max(0, left - (performance.now() - since));
  };
  const stop = () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };

  document.addEventListener('visibilitychange', onVisibility);
  count();
  return stop;
}
