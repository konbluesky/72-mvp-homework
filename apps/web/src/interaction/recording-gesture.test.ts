// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { protectRecordingGesture } from './recording-gesture.js';
const guards: ReturnType<typeof protectRecordingGesture>[] = [];
function setup() {
  const root = document.createElement('main');
  root.className = 'story-app';
  const button = document.createElement('button');
  root.append(button);
  document.body.append(root);
  const guard = protectRecordingGesture(button);
  guards.push(guard);
  return { root, button, guard };
}
afterEach(() => {
  for (const guard of guards.splice(0)) guard.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});
it('suppresses native menus and selection for a cancelled hold, then releases the protection', async () => {
  vi.useFakeTimers();
  const { root, guard } = setup();
  const menu = new Event('contextmenu', { bubbles: true, cancelable: true });
  root.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
  guard.finish();
  const late = new Event('contextmenu', { bubbles: true, cancelable: true });
  root.dispatchEvent(late);
  expect(late.defaultPrevented).toBe(true);
  await vi.advanceTimersByTimeAsync(600);
  const select = new Event('selectstart', { bubbles: true, cancelable: true });
  root.dispatchEvent(select);
  expect(select.defaultPrevented).toBe(false);
  expect(root.classList.contains('recording-gesture-active')).toBe(false);
});
it('an old release cannot clear a subsequent hold', async () => {
  vi.useFakeTimers();
  const first = setup();
  first.guard.finish();
  const next = protectRecordingGesture(first.button);
  guards.push(next);
  first.guard.dispose();
  await vi.advanceTimersByTimeAsync(600);
  const select = new Event('selectstart', { bubbles: true, cancelable: true });
  first.root.dispatchEvent(select);
  expect(select.defaultPrevented).toBe(true);
  expect(first.root.classList.contains('recording-gesture-active')).toBe(true);
  next.dispose();
  expect(first.root.classList.contains('recording-gesture-active')).toBe(false);
});
it('disposing on unmount and a missing terminal event both release the document listeners', async () => {
  vi.useFakeTimers();
  const first = setup();
  first.guard.dispose();
  const next = setup();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(next.root.classList.contains('recording-gesture-active')).toBe(false);
  const event = new Event('contextmenu', { bubbles: true, cancelable: true });
  next.root.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
