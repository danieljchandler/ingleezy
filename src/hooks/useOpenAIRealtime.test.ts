import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenAIRealtime } from "./useOpenAIRealtime";

/**
 * The live voice conversation — a learner talking to a model in real time.
 *
 * This is the only place in the app where nothing can be retried. A flashcard
 * that loads slowly is an annoyance; a voice session that drops mid-sentence
 * ends the conversation, and the learner has to work up to starting another
 * one. So the failure paths matter more than the happy one, and every one of
 * them has to release the microphone: a session that ends without stopping the
 * mic track leaves the browser's recording indicator lit, which is the single
 * most alarming thing a language app can do.
 *
 * The long-lived OpenAI key never reaches the browser. The edge function mints
 * a short-lived client secret, and the SDP exchange goes straight to OpenAI
 * with that — raw `application/sdp`, because routing it through the edge
 * runtime hit multipart serialization problems.
 *
 * Tested with its own transport rather than the in-memory backend, which
 * refuses foreign hosts by design — a guard worth keeping, and this hook has to
 * reach api.openai.com.
 */

const getSession = vi.fn(async () => ({
  data: { session: { access_token: "learner-jwt" } },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

// ── WebRTC doubles ──────────────────────────────────────────────────────────

interface FakeTrack {
  kind: string;
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
}

const aTrack = (): FakeTrack => ({ kind: "audio", enabled: true, stop: vi.fn() });

interface FakeDataChannel {
  close: ReturnType<typeof vi.fn>;
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

class FakePeerConnection {
  static last: FakePeerConnection | null = null;

  connectionState = "new";
  localDescription: { sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  channel: FakeDataChannel | null = null;
  transceivers: Array<{ kind: string; direction: string }> = [];
  senders: Array<{ track: FakeTrack | null }> = [];
  close = vi.fn();

  constructor() {
    FakePeerConnection.last = this;
  }

  addTransceiver(kind: string, init: { direction: string }) {
    this.transceivers.push({ kind, direction: init.direction });
  }

  addTrack(track: FakeTrack) {
    const sender = { track };
    this.senders.push(sender);
    return sender;
  }

  getSenders() {
    return this.senders;
  }

  createDataChannel(): FakeDataChannel {
    this.channel = { close: vi.fn(), onmessage: null, onopen: null, onerror: null };
    return this.channel;
  }

  async createOffer() {
    return { type: "offer", sdp: "v=0\r\no=- offer" };
  }

  async setLocalDescription(description: { sdp: string }) {
    this.localDescription = description;
  }

  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remoteDescription = description;
  }

  /** Drive a connection-state transition, as the browser would. */
  transitionTo(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  /** Deliver a data-channel event, as OpenAI would. */
  deliver(event: Record<string, unknown>) {
    this.channel?.onmessage?.({ data: JSON.stringify(event) });
  }
}

let micTracks: FakeTrack[] = [];
let getUserMediaThrows: Error | null = null;

const getUserMedia = vi.fn(async () => {
  if (getUserMediaThrows) throw getUserMediaThrows;
  const track = aTrack();
  micTracks.push(track);
  return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
});

class FakeAudioContext {
  static open = 0;
  constructor() {
    FakeAudioContext.open++;
  }
  createMediaStreamDestination() {
    return { stream: {} as MediaStream };
  }
  createOscillator() {
    return { connect: () => ({ connect: () => {} }), start: () => {} };
  }
  createGain() {
    return { gain: { value: 1 }, connect: () => ({ connect: () => {} }) };
  }
  async close() {
    FakeAudioContext.open--;
  }
}

// ── Transport ───────────────────────────────────────────────────────────────

const TOKEN_URL = "/functions/v1/realtime-session-token";
const OPENAI_URL = "https://api.openai.com/v1/realtime/calls";

let tokenReply: { status: number; body: string } = {
  status: 200,
  body: JSON.stringify({ client_secret: { value: "ephemeral-key" } }),
};
let sdpReply: { status: number; body: string } = { status: 200, body: "v=0\r\no=- answer" };

const calls: Array<{ url: string; init?: RequestInit }> = [];

const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, init });
  const reply = url.includes(TOKEN_URL) ? tokenReply : url === OPENAI_URL ? sdpReply : null;
  if (!reply) throw new Error(`Unstubbed request to ${url}`);
  return new Response(reply.body, { status: reply.status });
});

const originals = {
  RTCPeerConnection: (globalThis as Record<string, unknown>).RTCPeerConnection,
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
  AudioContext: (globalThis as Record<string, unknown>).AudioContext,
  fetch: globalThis.fetch,
};

beforeEach(() => {
  calls.length = 0;
  micTracks = [];
  getUserMediaThrows = null;
  FakePeerConnection.last = null;
  FakeAudioContext.open = 0;
  getSession.mockClear();
  fetchImpl.mockClear();
  tokenReply = { status: 200, body: JSON.stringify({ client_secret: { value: "ephemeral-key" } }) };
  sdpReply = { status: 200, body: "v=0\r\no=- answer" };

  (globalThis as Record<string, unknown>).RTCPeerConnection = FakePeerConnection;
  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal("fetch", fetchImpl);
});

afterEach(() => {
  (globalThis as Record<string, unknown>).RTCPeerConnection = originals.RTCPeerConnection;
  (globalThis as Record<string, unknown>).AudioContext = originals.AudioContext;
  if (originals.mediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originals.mediaDevices);
  }
  vi.stubGlobal("fetch", originals.fetch);
  document.querySelectorAll("audio").forEach((element) => element.remove());
});

const START: Parameters<ReturnType<typeof useOpenAIRealtime>["start"]>[0] = {
  dialect: "Gulf",
  difficulty: "beginner",
  topicHint: "at the souq",
};

/** Start a session and settle the connection handshake. */
async function startSession(
  result: { current: ReturnType<typeof useOpenAIRealtime> },
  args = START,
) {
  await act(async () => {
    await result.current.start(args);
  });
  return FakePeerConnection.last!;
}

/** Open the data channel, which is what flips the session to live. */
const goLive = (pc: FakePeerConnection) => {
  act(() => {
    pc.channel?.onopen?.();
  });
};

describe("starting a session", () => {
  it("gets a short-lived key from the edge function, not the real one", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    // The long-lived OpenAI key never reaches the browser; this call is the
    // whole reason the edge function exists.
    const tokenCall = calls.find((call) => call.url.includes(TOKEN_URL))!;
    expect(tokenCall.init?.headers).toMatchObject({ Authorization: "Bearer learner-jwt" });
    expect(JSON.parse(String(tokenCall.init?.body))).toMatchObject({
      dialect: "Gulf",
      difficulty: "beginner",
      topicHint: "at the souq",
    });
  });

  it("sends the offer to OpenAI as raw SDP with the ephemeral key", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    const sdpCall = calls.find((call) => call.url === OPENAI_URL)!;
    // `application/sdp` rather than multipart: routing the exchange through the
    // edge runtime hit serialization problems, and this goes direct.
    expect(sdpCall.init?.headers).toMatchObject({
      Authorization: "Bearer ephemeral-key",
      "Content-Type": "application/sdp",
    });
    expect(String(sdpCall.init?.body)).toContain("o=- offer");
  });

  it("applies the answer OpenAI sent back", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());

    const pc = await startSession(result);

    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: "v=0\r\no=- answer" });
  });

  it("asks for the model's audio as well as sending its own", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());

    const pc = await startSession(result);

    // Some browsers will not add a receive direction on their own, and without
    // it the learner hears nothing while the model speaks.
    expect(pc.transceivers).toContainEqual({ kind: "audio", direction: "recvonly" });
    expect(pc.senders).toHaveLength(1);
  });

  it("asks for a microphone configured for speech", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    // Echo cancellation especially: without it the model hears itself through
    // the learner's speakers and answers its own last sentence.
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it("stays connecting until the data channel opens", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());

    const pc = await startSession(result);
    expect(result.current.status).toBe("connecting");

    goLive(pc);

    // The SDP answer means the call is set up; the open channel means events
    // can actually flow, which is when the learner may start talking.
    expect(result.current.status).toBe("live");
  });

  it("refuses to start a second session over a live one", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);
    const before = calls.length;

    await act(async () => {
      await result.current.start(START);
    });

    // Two peer connections on one microphone is two conversations the learner
    // is having at once.
    expect(calls.length).toBe(before);
  });

  it("closes a leftover audio context before opening another", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const first = await startSession(result);
    goLive(first);
    act(() => {
      result.current.stop();
    });

    await startSession(result);

    // Browsers cap concurrent AudioContexts at around six, so a leak here
    // breaks voice practice after a handful of start/stop cycles.
    expect(FakeAudioContext.open).toBe(1);
  });
});

describe("when it cannot start", () => {
  it("reports a refused token and releases the microphone", async () => {
    tokenReply = { status: 402, body: JSON.stringify({ details: "Out of credit" }) };
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    // The detail is what the learner can act on; "402" is not.
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("Out of credit");
    expect(micTracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it("reports a token response with no secret in it", async () => {
    tokenReply = { status: 200, body: JSON.stringify({ ok: true }) };
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    // A 200 carrying nothing usable would otherwise fail later, inside the SDP
    // exchange, as an opaque 401 from OpenAI.
    expect(result.current.error).toContain("missing a client secret");
  });

  it("accepts either shape of client secret", async () => {
    tokenReply = { status: 200, body: JSON.stringify({ value: "flat-key" }) };
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    // The API has shipped both a bare string and a nested object; a session
    // should not die because the response shape changed.
    expect(calls.find((call) => call.url === OPENAI_URL)?.init?.headers).toMatchObject({
      Authorization: "Bearer flat-key",
    });
  });

  it("reports a refused SDP exchange", async () => {
    sdpReply = { status: 400, body: JSON.stringify({ error: "invalid session" }) };
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("invalid session");
    expect(micTracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it("reports a refused microphone, without saying it was refused", async () => {
    getUserMediaThrows = new DOMException("Permission denied", "NotAllowedError");
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    expect(result.current.status).toBe("error");
    // Pinned. `getUserMedia` rejects with a DOMException, which is not an
    // `Error`, so the `instanceof` check misses and the message is replaced by
    // the generic fallback. Declining the mic prompt is the commonest way this
    // fails and the one with an obvious remedy, and the learner is told only
    // that the app failed to start.
    expect(result.current.error).toBe("Failed to start voice session");
  });

  it("still releases the microphone when the mic itself failed", async () => {
    getUserMediaThrows = new DOMException("Permission denied", "NotAllowedError");
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    // Nothing was granted, so there is nothing to stop — but the peer
    // connection and the audio element were already created.
    expect(FakePeerConnection.last?.close).toHaveBeenCalled();
    expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
});

describe("the transcript", () => {
  it("builds the learner's speech up as it is recognised", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "u1",
        delta: "شخبارك",
      });
      pc.deliver({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "u1",
        delta: " اليوم",
      });
    });

    // One growing turn rather than two: the learner is watching their own
    // sentence appear, and splitting it would read as being interrupted.
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]).toMatchObject({
      role: "user",
      text: "شخبارك اليوم",
      partial: true,
    });
  });

  it("settles the learner's turn on the final transcript", async () => {
    const onTurnFinalized = vi.fn();
    const { result } = renderHook(() => useOpenAIRealtime({ onTurnFinalized }));
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "u1",
        delta: "شخبارك",
      });
      pc.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "شخبارك اليوم",
      });
    });

    // Whisper's final pass corrects what the streaming deltas guessed, so the
    // completed transcript replaces rather than appends.
    expect(result.current.turns[0]).toMatchObject({ text: "شخبارك اليوم", partial: false });
    expect(onTurnFinalized).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", text: "شخبارك اليوم" }),
    );
  });

  it("builds the model's reply the same way", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({
        type: "response.output_audio_transcript.delta",
        item_id: "a1",
        delta: "زين",
      });
      pc.deliver({ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "زين والله" });
    });

    expect(result.current.turns[0]).toMatchObject({
      role: "assistant",
      text: "زين والله",
      partial: false,
    });
  });

  it("accepts the older event names too", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({ type: "response.audio_transcript.delta", response_id: "r1", delta: "زين" });
      pc.deliver({ type: "response.audio_transcript.done", response_id: "r1", transcript: "زين" });
    });

    // The API renamed these; a session should not go silent because the model
    // is served from an endpoint using the previous names.
    expect(result.current.turns[0]).toMatchObject({ role: "assistant", text: "زين" });
  });

  it("keeps the two speakers' turns apart", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "u1",
        delta: "شخبارك",
      });
      pc.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "شخبارك",
      });
      pc.deliver({
        type: "response.output_audio_transcript.delta",
        item_id: "a1",
        delta: "زين",
      });
      pc.deliver({
        type: "response.output_audio_transcript.done",
        item_id: "a1",
        transcript: "زين",
      });
    });

    expect(result.current.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
  });

  it("does not report an empty turn", async () => {
    const onTurnFinalized = vi.fn();
    const { result } = renderHook(() => useOpenAIRealtime({ onTurnFinalized }));
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "   ",
      });
    });

    // Whisper emits an empty transcript for background noise, and a caller
    // logging every turn would fill the conversation with blanks.
    expect(onTurnFinalized).not.toHaveBeenCalled();
  });

  it("ignores an event it cannot parse", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.channel?.onmessage?.({ data: "not json" });
    });

    // One malformed frame must not end a conversation.
    expect(result.current.status).toBe("live");
    expect(result.current.turns).toEqual([]);
  });

  it("drops a turn that arrived with no streaming deltas", async () => {
    const onTurnFinalized = vi.fn();
    const { result } = renderHook(() => useOpenAIRealtime({ onTurnFinalized }));
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "شخبارك اليوم",
      });
    });

    // Pinned. Finalising maps over the existing turns rather than upserting, so
    // a `completed` event with no preceding delta matches nothing and the turn
    // never appears on screen — while the callback still fires, so it is
    // recorded in the session log the learner cannot see. A short utterance
    // transcribed in one pass is exactly when this happens.
    expect(result.current.turns).toEqual([]);
    expect(onTurnFinalized).toHaveBeenCalledWith(
      expect.objectContaining({ text: "شخبارك اليوم" }),
    );
  });

  it("surfaces a server error without ending the session", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({ type: "error", error: { message: "rate limit reached" } });
    });

    expect(result.current.error).toBe("rate limit reached");
    expect(result.current.status).toBe("live");
  });
});

describe("watching for the tutor leaving English", () => {
  it("flags Arabic in the practice partner's reply", async () => {
    const onDialectDrift = vi.fn();
    const { result } = renderHook(() => useOpenAIRealtime({ onDialectDrift }));
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "شلونك" });
      pc.deliver({
        type: "response.output_audio_transcript.done",
        item_id: "a1",
        transcript: "شلونك اليوم?",
      });
    });

    // The practice call IS the learner's English immersion. A partner that
    // answers in Arabic has quietly stopped being practice, and the learner —
    // relieved to understand it — is the last person who will object.
    expect(onDialectDrift).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("شلونك")]),
    );
    expect(result.current.turns[0].hasDialectDrift).toBe(true);
  });

  it("lets an all-English reply through", async () => {
    const onDialectDrift = vi.fn();
    const { result } = renderHook(() => useOpenAIRealtime({ onDialectDrift }));
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "How" });
      pc.deliver({
        type: "response.output_audio_transcript.done",
        item_id: "a1",
        transcript: "How was your weekend?",
      });
    });

    expect(onDialectDrift).not.toHaveBeenCalled();
    expect(result.current.turns[0].hasDialectDrift).toBe(false);
  });

  it("leaves the bilingual assistant alone", async () => {
    const onDialectDrift = vi.fn();
    const { result } = renderHook(() => useOpenAIRealtime({ onDialectDrift }));
    const pc = await startSession(result, { ...START, mode: "assistant" });
    goLive(pc);

    act(() => {
      pc.deliver({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "يعني" });
      pc.deliver({
        type: "response.output_audio_transcript.done",
        item_id: "a1",
        transcript: "يعني معناها كذا",
      });
    });

    // Explaining in the learner's dialect is the assistant persona's whole
    // job — flagging it would be flagging the feature.
    expect(onDialectDrift).not.toHaveBeenCalled();
    expect(result.current.turns[0].hasDialectDrift).toBe(false);
  });

  it("does not judge the learner's own Arabic", async () => {
    const onDialectDrift = vi.fn();
    const { result } = renderHook(() => useOpenAIRealtime({ onDialectDrift }));
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.deliver({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "u1",
        transcript: "ماذا تريد",
      });
    });

    // A learner falling back on the Arabic they already have is the normal way
    // in; flagging it would be correcting them for trying.
    expect(onDialectDrift).not.toHaveBeenCalled();
  });
});

describe("the minute meter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the call's duration when it ends", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result, { ...START, mode: "practice" });
    vi.useFakeTimers({ toFake: ["Date"] });
    goLive(pc);
    vi.setSystemTime(Date.now() + 65_000);

    act(() => {
      result.current.stop();
    });
    vi.useRealTimers();

    // The server meters monthly voice minutes from this report; a call that
    // ends silently is a call the meter never saw.
    await waitFor(() => {
      const report = calls.find((call) => String(call.init?.body ?? "").includes('"report"'));
      expect(report).toBeDefined();
      expect(JSON.parse(String(report!.init?.body))).toMatchObject({
        action: "report",
        mode: "practice",
        seconds: 65,
      });
    });
  });

  it("reports only once per call", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    vi.useFakeTimers({ toFake: ["Date"] });
    goLive(pc);
    vi.setSystemTime(Date.now() + 30_000);

    act(() => {
      result.current.stop();
    });
    act(() => {
      result.current.stop();
    });
    vi.useRealTimers();

    // stop() and the unmount cleanup can both run for one call; billing it
    // twice would drain the learner's balance at double speed.
    await waitFor(() => {
      expect(calls.filter((call) => String(call.init?.body ?? "").includes('"report"'))).toHaveLength(1);
    });
  });

  it("does not report a call that never went live", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    await startSession(result);

    act(() => {
      result.current.stop();
    });

    // Connecting isn't talking: a failed handshake must not spend minutes.
    expect(calls.some((call) => String(call.init?.body ?? "").includes('"report"'))).toBe(false);
  });

  it("shares the monthly balance the server returned with the token", async () => {
    tokenReply = {
      status: 200,
      body: JSON.stringify({
        client_secret: { value: "ephemeral-key" },
        voice_remaining_seconds: 540,
      }),
    };
    const { result } = renderHook(() => useOpenAIRealtime());

    await startSession(result);

    // The UI shows "N min left this month" from this value.
    expect(result.current.remainingSeconds).toBe(540);
  });
});

describe("the microphone", () => {
  it("mutes and unmutes the outgoing track", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      result.current.setMuted(true);
    });
    expect(micTracks[0].enabled).toBe(false);

    act(() => {
      result.current.setMuted(false);
    });
    // Disabling the track rather than tearing the sender down, so unmuting is
    // instant and does not renegotiate the call.
    expect(micTracks[0].enabled).toBe(true);
  });
});

describe("ending a session", () => {
  it("releases the microphone and closes the call", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      result.current.stop();
    });

    // The recording indicator staying lit after a conversation ends is the
    // single most alarming thing a language app can do.
    expect(micTracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
    expect(pc.close).toHaveBeenCalled();
    expect(pc.channel?.close).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("takes the hidden audio element with it", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      result.current.stop();
    });

    // It is appended to the document body to make some browsers route audio at
    // all; leaving one behind per session accumulates for the life of the tab.
    expect(document.querySelectorAll("audio")).toHaveLength(0);
  });

  it("says nothing about a connection that closed because the learner ended it", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      result.current.stop();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("reports a connection that dropped on its own", async () => {
    const { result } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    act(() => {
      pc.transitionTo("failed");
    });

    // A voice session cannot be resumed, so the learner needs to be told
    // rather than left talking to a dead connection.
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("failed");
    expect(micTracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it("releases everything when the screen goes away", async () => {
    const { result, unmount } = renderHook(() => useOpenAIRealtime());
    const pc = await startSession(result);
    goLive(pc);

    unmount();

    // Navigating away mid-conversation is the ordinary way these end.
    expect(micTracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
    expect(pc.close).toHaveBeenCalled();
  });

  it("is harmless when nothing was started", () => {
    const { result } = renderHook(() => useOpenAIRealtime());

    expect(() =>
      act(() => {
        result.current.stop();
      }),
    ).not.toThrow();
  });
});
