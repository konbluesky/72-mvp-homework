export interface RecordingGestureGuard {
  finish(): void;
  dispose(): void;
}

const owners = new WeakMap<Document, RecordingGestureGuard>();

/** A cancelled long press can emit contextmenu after pointercancel. Keep a bounded grace period. */
export function protectRecordingGesture(button: HTMLElement): RecordingGestureGuard {
  const document = button.ownerDocument;
  const scope = button.closest('.experience, .story-app') ?? button;
  owners.get(document)?.dispose();
  let disposed = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const preventNativeMenu = (event: Event) => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  const preventTouchCallout = (event: TouchEvent) => {
    if (event.target instanceof Node && button.contains(event.target) && event.cancelable)
      event.preventDefault();
  };
  const guard: RecordingGestureGuard = {
    finish() {
      if (disposed || finished) return;
      finished = true;
      document.removeEventListener('touchstart', preventTouchCallout, true);
      timer = setTimeout(() => guard.dispose(), 600);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      clearTimeout(safetyTimer);
      document.removeEventListener('contextmenu', preventNativeMenu, true);
      document.removeEventListener('selectstart', preventNativeMenu, true);
      document.removeEventListener('touchstart', preventTouchCallout, true);
      if (owners.get(document) === guard) {
        scope.classList.remove('recording-gesture-active');
        owners.delete(document);
      }
    },
  };
  owners.set(document, guard);
  scope.classList.add('recording-gesture-active');
  document.getSelection()?.removeAllRanges();
  document.addEventListener('contextmenu', preventNativeMenu, true);
  document.addEventListener('selectstart', preventNativeMenu, true);
  // React's delegated touch handlers are passive; this native handler must be cancelable.
  document.addEventListener('touchstart', preventTouchCallout, { capture: true, passive: false });
  // A removed target or browser gesture must not leave selection disabled indefinitely.
  const safetyTimer = setTimeout(() => guard.dispose(), 60_000);
  return guard;
}
