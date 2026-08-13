import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hapticPop, playSuccessChime, playTapChime, tapFeedback, vibrate } from "./tapFeedback";
import { setSoundEnabled } from "./uiPrefs";

/**
 * Tap chimes and haptics.
 *
 * These are the app's two accessibility opt-outs made concrete: "sound off"
 * has to silence every chime, and "reduce motion" has to stop both the pop
 * animation and the vibration — a buzz is motion whether or not it moves
 * pixels. Neither preference is visible in the UI once set, so a regression
 * here is only noticed by the people who most needed it to work.
 *
 * The Web Audio graph is stubbed rather than driven: what matters is whether
 * anything was scheduled at all, not the shape of the envelope.
 */

interface StubNode {
  connect: ReturnType<typeof vi.fn>;
  start?: ReturnType<typeof vi.fn>;
  stop?: ReturnType<typeof vi.fn>;
}

let started: number;
let contexts: number;
let resumes: number;

function stubAudio(state: AudioContextState = "running") {
  started = 0;
  contexts = 0;
  resumes = 0;

  const param = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });

  class StubContext {
    state = state;
    currentTime = 0;
    destination = {};
    resume = () => {
      resumes += 1;
    };
    constructor() {
      contexts += 1;
    }
    createOscillator(): StubNode {
      return {
        type: "sine",
        frequency: param(),
        connect: vi.fn(),
        start: vi.fn(() => {
          started += 1;
        }),
        stop: vi.fn(),
      } as unknown as StubNode;
    }
    createGain() {
      return { gain: param(), connect: vi.fn() };
    }
  }

  vi.stubGlobal("AudioContext", StubContext);
  return StubContext;
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  stubAudio();
  setReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the tap chime", () => {
  it("plays two voices by default", async () => {
    const { playTapChime: play } = await import("./tapFeedback");
    play();

    // A bell is the sine plus the triangle overtone; losing one leaves a tone
    // that reads as an error beep.
    expect(started).toBe(2);
  });

  it("stays silent when sound is switched off", async () => {
    setSoundEnabled(false);
    const { playTapChime: play } = await import("./tapFeedback");
    play();

    expect(started).toBe(0);
  });

  it("plays for a user who has never touched the setting", () => {
    // An unset preference means on — a silent app by default would read as
    // broken audio.
    expect(localStorage.getItem("ingleezy:ui-sound")).toBeNull();
    playTapChime();

    expect(started).toBeGreaterThan(0);
  });

  it("reuses one audio context across taps", async () => {
    // A fresh module, because the context is cached at module scope for the
    // life of the page — which is the property under test.
    const { playTapChime: play } = await import("./tapFeedback");
    play();
    play();
    play();

    // Browsers cap the number of live AudioContexts; opening one per tap runs
    // a session out of them and every later chime fails silently.
    expect(contexts).toBe(1);
  });

  it("resumes a context the browser suspended", async () => {
    stubAudio("suspended");
    const { playTapChime: play } = await import("./tapFeedback");

    play();

    // Autoplay policy suspends the context until a gesture; without the resume
    // the first chime after a page load is lost.
    expect(resumes).toBeGreaterThan(0);
  });

  it("swallows a Web Audio failure rather than breaking the tap", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio device");
        }
      },
    );

    // The chime is decoration on a button press; a machine with no output
    // device must still be able to use the button.
    expect(() => playTapChime()).not.toThrow();
  });
});

describe("the success chime", () => {
  it("plays a three-note arpeggio", () => {
    playSuccessChime();

    expect(started).toBe(3);
  });

  it("stays silent when sound is switched off", async () => {
    setSoundEnabled(false);
    const { playSuccessChime: play } = await import("./tapFeedback");
    play();

    expect(started).toBe(0);
  });
});

describe("vibration", () => {
  it("buzzes with the pattern it was given", () => {
    const buzz = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate: buzz });

    vibrate([10, 20, 10]);

    expect(buzz).toHaveBeenCalledWith([10, 20, 10]);
  });

  it("defaults to a single short buzz", () => {
    const buzz = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate: buzz });

    vibrate();

    expect(buzz).toHaveBeenCalledWith(10);
  });

  it("stays still when the user asked for reduced motion", () => {
    setReducedMotion(true);
    const buzz = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate: buzz });

    vibrate();

    // A haptic buzz is motion. Honouring the preference for animation but not
    // for vibration would miss the people it exists for.
    expect(buzz).not.toHaveBeenCalled();
  });

  it("does nothing on a device with no vibration motor", () => {
    vi.stubGlobal("navigator", { ...navigator, vibrate: undefined });

    expect(() => vibrate()).not.toThrow();
  });
});

describe("the visual pop", () => {
  it("adds the animation class and removes it when the animation ends", () => {
    const el = document.createElement("button");
    document.body.append(el);

    hapticPop(el);
    expect(el.classList.contains("animate-pop")).toBe(true);

    el.dispatchEvent(new Event("animationend"));
    // Leaving the class on would stop the element ever animating again.
    expect(el.classList.contains("animate-pop")).toBe(false);

    el.remove();
  });

  it("does not animate when the user asked for reduced motion", () => {
    setReducedMotion(true);
    const el = document.createElement("button");

    hapticPop(el);

    expect(el.classList.contains("animate-pop")).toBe(false);
  });
});

describe("the combined feedback", () => {
  it("chimes and pops together", () => {
    const el = document.createElement("button");

    tapFeedback(el);

    expect(started).toBeGreaterThan(0);
    expect(el.classList.contains("animate-pop")).toBe(true);
  });

  it("still chimes with no element to pop", () => {
    // Most callers pass a ref that may not be attached yet.
    expect(() => tapFeedback(null)).not.toThrow();
    expect(started).toBeGreaterThan(0);
  });
});
