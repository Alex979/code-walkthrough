import { expect, test } from "bun:test";
import { animateScroll, minimalRevealScrollTop, reserveScrollSpace } from "../viewer/src/scroll";

test("reveal keeps fully visible code stable, including viewport boundaries", () => {
  expect(minimalRevealScrollTop(100, 400, 100, 500)).toBe(100);
  expect(minimalRevealScrollTop(100, 400, 180, 350)).toBe(100);
});

test("a fitting range moves only far enough to reveal its hidden edge", () => {
  expect(minimalRevealScrollTop(100, 400, 300, 550)).toBe(150);
  expect(minimalRevealScrollTop(100, 400, 80, 350)).toBe(80);
});

test("oversized additions reveal their beginning in either scroll direction", () => {
  expect(minimalRevealScrollTop(100, 400, 250, 900)).toBe(250);
  expect(minimalRevealScrollTop(600, 400, 250, 900)).toBe(250);
});

test("bottom context reveals the end of a change without moving code that already has room", () => {
  expect(minimalRevealScrollTop(100, 400, 300, 550, 40)).toBe(190);
  expect(minimalRevealScrollTop(100, 400, 200, 500, 40)).toBe(140);
  expect(minimalRevealScrollTop(100, 400, 200, 460, 40)).toBe(100);
});

test("bottom context shrinks before it can hide the beginning of a change", () => {
  expect(minimalRevealScrollTop(100, 400, 200, 590, 40)).toBe(200);
  expect(minimalRevealScrollTop(100, 400, 200, 600, 40)).toBe(200);
  expect(minimalRevealScrollTop(100, 400, 200, 700, 40)).toBe(200);
  expect(minimalRevealScrollTop(300, 400, 200, 550, 40)).toBe(200);
});

test("invalid geometry and a hidden viewport do not move the reader", () => {
  expect(minimalRevealScrollTop(100, 0, 200, 300)).toBe(100);
  expect(minimalRevealScrollTop(100, 400, 300, 200)).toBe(100);
  expect(minimalRevealScrollTop(100, 400, NaN, 300)).toBe(100);
  expect(minimalRevealScrollTop(100, Infinity, 200, 300)).toBe(100);
  expect(minimalRevealScrollTop(NaN, 0, 200, 300)).toBe(0);
  expect(minimalRevealScrollTop(0, 400, -20, 100)).toBe(0);
});

function animationHarness(reduceMotion = false) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const motion = Object.assign(new EventTarget(), { matches: reduceMotion });
  const body = Object.assign(new EventTarget(), {
    scrollTop: 100,
    scrollHeight: 1400,
    clientHeight: 400,
    ownerDocument: {
      defaultView: {
        matchMedia: () => motion,
        requestAnimationFrame: (callback: FrameRequestCallback): number => {
          frames.set(++nextFrame, callback);
          return nextFrame;
        },
        cancelAnimationFrame: (id: number): void => {
          frames.delete(id);
        },
      },
    },
  });
  const tick = (time: number): void => {
    const queued = [...frames.values()];
    frames.clear();
    for (const callback of queued) {
      callback(time);
    }
  };
  return { body, element: body as unknown as HTMLElement, motion, frames, tick };
}

test("animation preserves the start, moves smoothly and completes at the clamped destination", () => {
  const { body, element, frames, tick } = animationHarness();
  let finished = 0;
  const cancel = animateScroll(element, 2000, () => finished++);
  expect(body.scrollTop).toBe(100);
  tick(0);
  tick(80);
  // The first five frames should not carry the reader past their old context.
  expect(body.scrollTop).toBeGreaterThan(100);
  expect(body.scrollTop).toBeLessThan(145);
  tick(600);
  expect(body.scrollTop).toBe(1000);
  expect(finished).toBe(1);
  expect(frames.size).toBe(0);
  cancel();
  expect(finished).toBe(1);
});

test("scroll accelerates gently and slows before arriving in either direction", () => {
  for (const destination of [700, 0]) {
    const { body, element, tick } = animationHarness();
    animateScroll(element, destination);
    const positions = [body.scrollTop];
    for (const time of [0, 100, 200, 300, 400, 500, 600]) {
      tick(time);
      if (time > 0) {
        positions.push(body.scrollTop);
      }
    }
    const distances = positions
      .slice(1)
      .map((position, index) => Math.abs(position - positions[index]));
    expect(distances[0]).toBeLessThan(distances[1]);
    expect(distances[1]).toBeLessThan(distances[2]);
    expect(distances[3]).toBeGreaterThan(distances[4]);
    expect(distances[4]).toBeGreaterThan(distances[5]);
    expect(body.scrollTop).toBe(destination);
  }
});

test("new navigation or reader pointer input cancels without completing or snapping", () => {
  for (const action of ["wheel", "touchstart", "pointerdown", "navigation"]) {
    const { body, element, motion, frames, tick } = animationHarness();
    let finished = 0;
    const cancel = animateScroll(element, 700, () => finished++);
    tick(0);
    tick(100);
    const interruptedAt = body.scrollTop;
    if (action === "navigation") {
      cancel();
    } else {
      body.dispatchEvent(new Event(action));
    }
    expect(frames.size).toBe(0);
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    tick(700);
    expect(body.scrollTop).toBe(interruptedAt);
    expect(finished).toBe(0);
  }
});

test("scroll keys interrupt, while unrelated keys leave motion running", () => {
  for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]) {
    const { body, element, frames } = animationHarness();
    animateScroll(element, 700);
    body.dispatchEvent(Object.assign(new Event("keydown"), { key: "a" }));
    expect(frames.size).toBe(1);
    body.dispatchEvent(Object.assign(new Event("keydown"), { key }));
    expect(frames.size).toBe(0);
  }
});

test("reduced motion immediately reveals code without scheduling animation", () => {
  const { body, element, frames } = animationHarness(true);
  let finished = 0;
  animateScroll(element, 700, () => finished++);
  expect(body.scrollTop).toBe(700);
  expect(frames.size).toBe(0);
  expect(finished).toBe(1);
});

test("enabling reduced motion during scrolling finishes and removes its listener", () => {
  const { body, element, motion, frames, tick } = animationHarness();
  let finished = 0;
  animateScroll(element, 700, () => finished++);
  tick(0);
  tick(100);
  motion.matches = true;
  motion.dispatchEvent(new Event("change"));
  expect(body.scrollTop).toBe(700);
  expect(frames.size).toBe(0);
  expect(finished).toBe(1);
  body.scrollTop = 200;
  motion.dispatchEvent(new Event("change"));
  expect(body.scrollTop).toBe(200);
  expect(finished).toBe(1);
});

test("animation remains inside scroll bounds when the content shrinks", () => {
  const { body, element, tick } = animationHarness();
  animateScroll(element, 700);
  tick(0);
  body.scrollHeight = 600;
  tick(300);
  expect(body.scrollTop).toBe(200);
  tick(600);
  expect(body.scrollTop).toBe(200);
});

function reservationHarness(contentHeight = 600) {
  const animation = animationHarness();
  const { body } = animation;
  const spacers = new Set<{ style: { height: string } }>();
  let scrollTop = 0;
  const clamp = (): void => {
    scrollTop = Math.min(scrollTop, body.scrollHeight - body.clientHeight);
  };
  Object.defineProperties(body, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, value);
        clamp();
      },
    },
    scrollHeight: {
      get: () =>
        Math.max(
          body.clientHeight,
          contentHeight +
            [...spacers].reduce((total, spacer) => total + parseFloat(spacer.style.height), 0),
        ),
    },
  });
  Object.assign(body.ownerDocument, {
    createElement: () => {
      let height = "0px";
      const spacer = {
        style: {
          get height() {
            return height;
          },
          set height(value: string) {
            height = value;
            clamp();
          },
        },
        setAttribute: () => {},
        remove: () => {
          spacers.delete(spacer);
          clamp();
        },
      };
      return spacer;
    },
  });
  Object.assign(body, {
    append: (spacer: { style: { height: string } }) => spacers.add(spacer),
  });
  return { ...animation, spacers };
}

test("temporary space preserves a backward starting position and releases at its natural destination", () => {
  const { body, element, spacers, tick } = reservationHarness();
  const space = reserveScrollSpace(element, 700);
  expect(space.maxScrollTop).toBe(200);
  expect(body.scrollHeight - body.clientHeight).toBe(700);
  body.scrollTop = 700;
  animateScroll(element, 100, space.release, space.release);
  tick(0);
  expect(body.scrollTop).toBe(700);
  tick(300);
  expect(body.scrollTop).toBeGreaterThan(200);
  tick(600);
  expect(body.scrollTop).toBe(100);
  expect(spacers.size).toBe(0);
});

test("reservation accounts for empty viewport space and skips already reachable positions", () => {
  const { body, element, spacers } = reservationHarness(100);
  const space = reserveScrollSpace(element, 300);
  expect(space.maxScrollTop).toBe(0);
  expect(body.scrollHeight - body.clientHeight).toBe(300);
  body.scrollTop = 300;
  expect(body.scrollTop).toBe(300);
  space.dispose();
  expect(spacers.size).toBe(0);
  for (const target of [0, -10, NaN, Infinity]) {
    const unused = reserveScrollSpace(element, target);
    unused.release();
    unused.dispose();
    expect(spacers.size).toBe(0);
  }
});

test("interruption retains the reader's position and sheds temporary space as they scroll up", () => {
  const { body, element, spacers, tick } = reservationHarness();
  const space = reserveScrollSpace(element, 700);
  body.scrollTop = 700;
  animateScroll(element, 100, space.release, space.release);
  tick(0);
  tick(300);
  const interruptedAt = body.scrollTop;
  body.dispatchEvent(new Event("wheel"));
  expect(body.scrollTop).toBe(interruptedAt);
  expect(body.scrollHeight - body.clientHeight).toBeGreaterThanOrEqual(interruptedAt);
  expect(body.scrollHeight - body.clientHeight).toBeLessThan(interruptedAt + 1);
  body.scrollTop = 250;
  body.dispatchEvent(new Event("scroll"));
  expect(body.scrollTop).toBe(250);
  expect(body.scrollHeight - body.clientHeight).toBe(250);
  body.scrollTop = 180;
  body.dispatchEvent(new Event("scroll"));
  expect(body.scrollTop).toBe(180);
  expect(spacers.size).toBe(0);
  space.release();
  space.dispose();
});

test("animation reports cancellation once without confusing completion with interruption", () => {
  for (const action of ["finish", "cancel", "wheel", "touchstart", "pointerdown", "keydown"]) {
    const { body, element, tick } = animationHarness();
    let finished = 0;
    let cancelled = 0;
    const cancel = animateScroll(
      element,
      700,
      () => finished++,
      () => cancelled++,
    );
    tick(0);
    if (action === "finish") {
      tick(600);
    } else if (action === "cancel") {
      cancel();
    } else {
      body.dispatchEvent(Object.assign(new Event(action), { key: "ArrowUp" }));
    }
    cancel();
    expect(finished).toBe(action === "finish" ? 1 : 0);
    expect(cancelled).toBe(action === "finish" ? 0 : 1);
  }
});
