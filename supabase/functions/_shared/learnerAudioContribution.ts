// W5 of the flywheel: opt-in retention of a learner's scored audio.
//
// Pronunciation and shadowing clips are scored and discarded by default — the
// correct default. A learner who has switched on "contribute recordings" in
// Settings (profiles.contribute_audio, consent covered in the Terms) instead
// has the clip kept: accented Arabic paired with a known target text and a
// score, which is scarce and genuinely valuable for robust-ASR work.
//
// Fire-and-forget contract like every sink: the learner's score response must
// never wait on, or fail because of, this bookkeeping. The one difference is
// EdgeRuntime.waitUntil — an upload outlives the response, and without it the
// runtime may kill the isolate mid-write.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

interface ContributionArgs {
  userId: string;
  /** Already normalized: Gulf | Egyptian | Yemeni. */
  dialect: string;
  audioBytes: Uint8Array;
  /** Base MIME type, e.g. "audio/webm". */
  mimeType: string;
  /** The text the learner was trying to say. */
  referenceText: string;
  /** What the recognizer heard, when available. */
  recognizedText: string | null;
  /** Overall score (0–100), when available. */
  score: number | null;
  sourceFunction: string;
}

/** Clips above this are almost certainly not a single utterance. */
const MAX_CLIP_BYTES = 2 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
};

let cached: ReturnType<typeof createClient> | null = null;
function client() {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

async function contribute(args: ContributionArgs): Promise<void> {
  const sb = client();
  if (!sb) return;
  if (!args.referenceText.trim()) return;
  if (args.audioBytes.byteLength === 0 || args.audioBytes.byteLength > MAX_CLIP_BYTES) return;
  if (!['Gulf', 'Egyptian', 'Yemeni'].includes(args.dialect)) return;

  // The consent flag, read fresh per contribution — a learner who switches it
  // off must stop contributing with their next clip, not their next session.
  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('contribute_audio')
    .eq('user_id', args.userId)
    .maybeSingle();
  if (profileErr || (profile as { contribute_audio?: boolean } | null)?.contribute_audio !== true) {
    return;
  }

  // Keyed {user_id}/{uuid}.{ext} so honouring a deletion request is one
  // prefix removal.
  const ext = EXT_BY_MIME[args.mimeType] ?? 'webm';
  const path = `${args.userId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await sb.storage
    .from('learner-audio')
    .upload(path, args.audioBytes.slice().buffer as ArrayBuffer, { contentType: args.mimeType });
  if (uploadErr) {
    console.warn('[learnerAudioContribution] upload failed:', uploadErr.message);
    return;
  }

  const { error: insertErr } = await sb.from('training_examples').insert([
    {
      task_type: 'pronunciation',
      dialect: args.dialect,
      machine_output: args.recognizedText?.trim() || '(not recognized)',
      human_output: args.referenceText.trim(),
      context: { score: args.score, mime: args.mimeType, bytes: args.audioBytes.byteLength },
      audio_bucket: 'learner-audio',
      audio_path: path,
      source_table: 'learner_audio',
      source_function: args.sourceFunction,
      corrector_role: 'learner',
      corrector_id: args.userId,
      tier: 'bronze',
      source_license: 'learner_contributed',
      pii_reviewed: false,
    },
  ] as unknown as never);
  if (insertErr) console.warn('[learnerAudioContribution] insert failed:', insertErr.message);
}

export function contributeLearnerAudio(args: ContributionArgs): void {
  try {
    const task = contribute(args).catch((e) =>
      console.warn('[learnerAudioContribution] failed:', e instanceof Error ? e.message : e),
    );
    // Keep the isolate alive past the response for the upload, where supported.
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil?.(task);
  } catch (e) {
    console.warn('[learnerAudioContribution] failed:', e instanceof Error ? e.message : e);
  }
}
