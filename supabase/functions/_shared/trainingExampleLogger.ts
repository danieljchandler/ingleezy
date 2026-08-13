// Fire-and-forget writer for `training_examples` — the flywheel's bronze lane.
// Gold and silver rows come from humans (the transcript editor via
// record-transcript-corrections, native reviews via a DB trigger); this sink
// is for automated corrections, currently the Brain's MSA repair pass: what
// the model first said against what the repair made of it. Distillation data,
// and eval-negative mining.
//
// Same contract as every sink here: never throws, never awaited on the
// request path.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Dialect } from './dialectHelpers.ts';

interface RepairPairArgs {
  dialect: Dialect;
  /** What the model produced before the repair pass. */
  machineOutput: string;
  /** What the repair pass turned it into. */
  repairedOutput: string;
  /** The Brain task's purpose. */
  sourceFunction: string;
  /** The leak tokens that triggered the repair. */
  leaks: string[];
  metadata?: Record<string, unknown>;
}

let cached: ReturnType<typeof createClient> | null = null;
function client() {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function logRepairPair(args: RepairPairArgs): void {
  try {
    const before = args.machineOutput?.trim();
    const after = args.repairedOutput?.trim();
    if (!before || !after || before === after) return;
    const sb = client();
    if (!sb) return;
    sb.from('training_examples')
      .insert([
        {
          task_type: 'generation',
          dialect: args.dialect,
          machine_output: before.slice(0, 8000),
          human_output: after.slice(0, 8000),
          context: { leaks: args.leaks.slice(0, 20), ...(args.metadata ?? {}) },
          source_table: 'ai_brain',
          source_function: args.sourceFunction,
          corrector_role: 'auto_repair',
          tier: 'bronze',
        },
      ] as unknown as never)
      .then(
        ({ error }: { error: { message: string } | null }) => {
          if (error) console.warn('[trainingExampleLogger] insert failed:', error.message);
        },
        (err: unknown) => console.warn('[trainingExampleLogger] insert threw:', err),
      );
  } catch (e) {
    console.warn('[trainingExampleLogger] failed:', e instanceof Error ? e.message : e);
  }
}
