/** All coordinates use the same scroll-content origin. Callers exclude sticky
 * headers from viewportHeight and offset targets into the usable viewport. */
export function minimalRevealScrollTop(
  scrollTop: number,
  viewportHeight: number,
  targetTop: number,
  targetBottom: number,
  bottomContext = 0,
): number {
  const current = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  if (
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(targetTop) ||
    !Number.isFinite(targetBottom) ||
    viewportHeight <= 0 ||
    targetBottom < targetTop
  ) {
    return current;
  }

  if (targetBottom - targetTop > viewportHeight || targetTop < current) {
    return Math.max(0, targetTop);
  }
  // Context makes the end of a change visible, but must never hide its beginning.
  const requestedContext = Number.isFinite(bottomContext) ? Math.max(0, bottomContext) : 0;
  const availableContext = viewportHeight - (targetBottom - targetTop);
  const revealBottom = targetBottom + Math.min(requestedContext, availableContext);
  if (revealBottom > current + viewportHeight) {
    return Math.max(0, revealBottom - viewportHeight);
  }
  return current;
}

/** Keep a backward transition's anchor reachable after code has been removed.
 * Release after completion or interruption; dispose before replacing the view. */
export function reserveScrollSpace(
  body: HTMLElement,
  desiredScrollTop: number,
): { maxScrollTop: number; release: () => void; dispose: () => void } {
  const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
  if (!Number.isFinite(desiredScrollTop) || desiredScrollTop <= maxScrollTop) {
    return { maxScrollTop, release: () => {}, dispose: () => {} };
  }

  const spacer = body.ownerDocument.createElement("div");
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.flexShrink = "0";
  spacer.style.overflowAnchor = "none";
  // Start large enough to overflow even when the content is shorter than the
  // viewport, then measure away the surplus instead of assuming its height.
  const reservedTop = Math.ceil(desiredScrollTop);
  let height = reservedTop + body.clientHeight;
  spacer.style.height = `${height}px`;
  body.append(spacer);
  height -= body.scrollHeight - body.clientHeight - reservedTop;
  spacer.style.height = `${Math.max(0, height)}px`;
  let disposed = false;
  let releasing = false;

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    body.removeEventListener("scroll", shrink);
    spacer.remove();
  };
  const shrink = (): void => {
    if (disposed) {
      return;
    }
    if (body.scrollTop <= maxScrollTop) {
      dispose();
      return;
    }
    // On interruption, retain only the space under the reader's current
    // position. Removing it all here would cause the clamp we are avoiding.
    const surplus = body.scrollHeight - body.clientHeight - body.scrollTop;
    height = Math.max(0, height - Math.max(0, Math.floor(surplus)));
    spacer.style.height = `${height}px`;
  };
  const release = (): void => {
    if (disposed || releasing) {
      return;
    }
    releasing = true;
    body.addEventListener("scroll", shrink, { passive: true });
    shrink();
  };
  return { maxScrollTop, release, dispose };
}

/** Animate after the caller restores a source-line anchor. Reader input or a
 * later navigation can cancel without snapping to the unfinished destination. */
export function animateScroll(
  body: HTMLElement,
  target: number,
  onFinish?: () => void,
  onCancel?: () => void,
): () => void {
  const view = body.ownerDocument.defaultView;
  const clamp = (value: number): number => {
    const maximum = Math.max(0, body.scrollHeight - body.clientHeight);
    return Math.min(maximum, Math.max(0, value));
  };
  const destination = Number.isFinite(target) ? clamp(target) : body.scrollTop;
  const reducedMotion = view?.matchMedia("(prefers-reduced-motion: reduce)");
  if (!view || reducedMotion?.matches || destination === body.scrollTop) {
    body.scrollTop = destination;
    onFinish?.();
    return () => {};
  }

  const start = body.scrollTop;
  // Give readers time to follow their source anchor before it leaves the viewport.
  // A gentle start and finish avoid making a correct reveal feel like a jump.
  const duration = 600;
  let startedAt: number | undefined;
  let frame = 0;
  let stopped = false;

  const stop = (): boolean => {
    if (stopped) {
      return false;
    }
    stopped = true;
    view.cancelAnimationFrame(frame);
    body.removeEventListener("wheel", cancel);
    body.removeEventListener("touchstart", cancel);
    body.removeEventListener("pointerdown", cancel);
    body.removeEventListener("keydown", onKeyDown);
    reducedMotion?.removeEventListener("change", onMotionChange);
    return true;
  };
  const cancel = (): void => {
    if (stop()) {
      onCancel?.();
    }
  };
  const finish = (): void => {
    if (stop()) {
      onFinish?.();
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      cancel();
    }
  };
  const onMotionChange = (): void => {
    if (reducedMotion?.matches) {
      body.scrollTop = clamp(destination);
      finish();
    }
  };
  const tick = (time: number): void => {
    if (stopped) {
      return;
    }
    startedAt ??= time;
    const progress = Math.min(1, Math.max(0, (time - startedAt) / duration));
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    body.scrollTop = clamp(start + (destination - start) * eased);
    if (progress === 1) {
      finish();
      return;
    }
    frame = view.requestAnimationFrame(tick);
  };

  body.addEventListener("wheel", cancel, { passive: true });
  body.addEventListener("touchstart", cancel, { passive: true });
  body.addEventListener("pointerdown", cancel, { passive: true });
  body.addEventListener("keydown", onKeyDown);
  reducedMotion?.addEventListener("change", onMotionChange);
  frame = view.requestAnimationFrame(tick);
  return cancel;
}
