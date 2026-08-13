/**
 * Browser behaviour a containerised Chromium does not provide.
 *
 * Deliberately small. Media capture is handled by Chromium's own
 * `--use-fake-device-for-media-stream` flag (see playwright.config.ts) rather
 * than by stand-ins here: that yields a real `MediaStream` with real
 * `MediaStreamTrack`s, and the difference is not cosmetic — a hand-written
 * stand-in is rejected outright by `RTCPeerConnection.addTrack`, which is how
 * the conversation simulator's live-voice panel starts a session. Faking as
 * little as possible is what keeps these tests about the app.
 *
 * Injected via `page.addInitScript`, which serialises the function into the
 * page, so it cannot reference anything outside its own body.
 */
export function installBrowserFakes(): void {
  // The container's Chromium has no clipboard permission, so every copy button
  // throws a NotAllowedError that has nothing to do with the app.
  //
  // Recorded rather than discarded, for the same reason `window.open` is: a
  // copy button's whole job is putting a *particular* string on the clipboard,
  // and "it did not throw" does not check that. Read it from a spec as
  // `window.__copiedText`.
  const copied: string[] = [];
  (window as unknown as { __copiedText: string[] }).__copiedText = copied;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied.push(String(text));
      },
      readText: async () => copied[copied.length - 1] ?? "",
      write: async () => undefined,
      read: async () => [],
    },
  });

  // Headless Chromium ships no speech voices, and the alphabet and pronunciation
  // pages call speak() on mount.
  const synthesis = window.speechSynthesis as SpeechSynthesis | undefined;
  if (synthesis) {
    synthesis.speak = () => undefined;
    synthesis.cancel = () => undefined;
  }

  // Checkout and the billing portal hand off by opening a Stripe URL in a new
  // tab. Letting that happen would drive a real popup at stripe.com, which the
  // hermetic guard has to block anyway — and a blocked popup is indistinguishable
  // from a handoff the app never attempted. Recording the URL instead is what
  // makes "it sent the learner to checkout" assertable at all.
  const opened: string[] = [];
  (window as unknown as { __openedUrls: string[] }).__openedUrls = opened;
  window.open = (url?: string | URL) => {
    opened.push(String(url ?? ""));
    return null;
  };
}
