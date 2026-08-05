/**
 * Collapse a burst of events into one call per animation frame.
 *
 * Scroll, resize and MutationObserver all fire far faster than anything we do
 * in response is worth running - and on an ATS form the observer fires on every
 * keystroke, because React re-renders the field being typed into. Doing layout
 * reads at that rate is how an extension gets blamed for a janky form.
 *
 * A hidden tab never runs animation frames, so a queued call simply waits until
 * the tab is looked at again - which is exactly when its result starts to
 * matter.
 */
export function throttled(fn: () => void): () => void {
  let queued = false;

  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}
