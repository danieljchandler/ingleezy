import {
  hasBibleAccessFromRoles,
  MANAGED_ROLES,
  type AppRole,
  type ManagedRole,
} from "../../../lib/rbac";
import type { MemoryDb } from "../postgrest/store";
import type { Row } from "../postgrest/types";

/**
 * Postgres functions the app calls through `supabase.rpc(...)`.
 *
 * These are not stubs returning fixed values — they read and write `MemoryDb`,
 * so seeding a role row is enough to make `has_role` answer correctly
 * everywhere. That matters because the previous double returned `null` for
 * every RPC, and `useAdminAuth` resolves all three of its role checks through
 * `has_role`: every one of the 38 admin routes was untestable as a result.
 */

export interface RpcContext {
  db: MemoryDb;
  /** The caller, from the Authorization header. Null when signed out. */
  userId: string | null;
  args: Record<string, unknown>;
  /**
   * Accounts, standing in for `auth.users`. Only the RPCs that are
   * security-definer in the real database get to see this — which is the point
   * of them.
   */
  users: {
    find: (identifier: string) => { id: string; email: string } | undefined;
    list: () => Array<{ id: string; email: string }>;
  };
}

export type RpcHandler = (context: RpcContext) => unknown;

const rolesFor = (db: MemoryDb, userId: string | null): AppRole[] =>
  userId === null
    ? []
    : db
        .rows("user_roles")
        .filter((row) => row.user_id === userId)
        .map((row) => row.role as AppRole);

/** Read an arg under either its bare or underscore-prefixed name. */
const arg = (args: Record<string, unknown>, name: string): unknown =>
  args[`_${name}`] ?? args[name];

export const defaultRpcs: Record<string, RpcHandler> = {
  has_role: ({ db, userId, args }) => {
    const target = (arg(args, "user_id") as string | undefined) ?? userId;
    const role = arg(args, "role") as string;
    return rolesFor(db, target ?? null).includes(role as AppRole);
  },

  is_admin: ({ db, userId }) => rolesFor(db, userId).includes("admin"),

  is_beta_tester: ({ db, userId }) => {
    const roles = rolesFor(db, userId);
    return roles.includes("beta_tester") || roles.includes("admin");
  },

  is_content_reviewer: ({ db, userId }) => rolesFor(db, userId).includes("content_reviewer"),

  is_recorder: ({ db, userId }) => rolesFor(db, userId).includes("recorder"),

  can_manage_content: ({ db, userId }) => {
    const roles = rolesFor(db, userId);
    return roles.includes("admin") || roles.includes("recorder") || roles.includes("content_reviewer");
  },

  // Delegates to the app's own rule rather than restating it, so the two cannot
  // disagree. The rule is subtle — bible_reader is revoked by content_reviewer —
  // and a second copy here would be a second thing to get wrong.
  has_bible_access: ({ db, userId }) => hasBibleAccessFromRoles(rolesFor(db, userId)),

  user_has_bible_access: ({ db, args }) =>
    hasBibleAccessFromRoles(rolesFor(db, arg(args, "user_id") as string)),

  // Both of these join auth.users in the real database, which is the whole
  // reason they exist as security-definer RPCs — the client cannot read that
  // table, so it cannot resolve an email itself. `findUser`/`listUsers` on the
  // backend stand in for it; profiles has no email column.
  admin_list_managed_roles: ({ db, users }) => {
    const profiles = new Map(db.rows("profiles").map((row) => [row.user_id, row]));
    const accounts = new Map(users.list().map((user) => [user.id, user]));

    return db
      .rows("user_roles")
      .filter((row) => MANAGED_ROLES.includes(row.role as ManagedRole))
      .map((row) => ({
        // The row id, not just the user id: BibleAccess keys its table on it and
        // revokes by it, so omitting it renders unkeyed rows and breaks revoke.
        id: row.id,
        user_id: row.user_id,
        role: row.role,
        // The function's signature is (id, user_id, role, created_at, email).
        // Omitting created_at rendered the "Added" column as "Invalid Date" —
        // a real column the double simply did not answer.
        created_at: row.created_at,
        email: accounts.get(row.user_id as string)?.email ?? null,
        display_name: (profiles.get(row.user_id)?.display_name as string) ?? null,
      }));
  },

  admin_find_user: ({ db, args, users }) => {
    const found = users.find(String(arg(args, "identifier") ?? ""));
    if (!found) return [];

    const profile = db.rows("profiles").find((row) => row.user_id === found.id);
    return [{ user_id: found.id, email: found.email, display_name: profile?.display_name ?? null }];
  },

  award_xp: ({ db, userId, args }) => {
    const amount = Number(arg(args, "amount") ?? 0);
    const rows = db.raw("user_xp");
    const today = new Date().toISOString().slice(0, 10);

    let record = rows.find((row) => row.user_id === userId);
    if (!record) {
      record = { user_id: userId, total_xp: 0, current_level: 1, xp_today: 0, xp_today_date: today };
      rows.push(record);
    }

    record.total_xp = Number(record.total_xp ?? 0) + amount;
    record.xp_today = (record.xp_today_date === today ? Number(record.xp_today ?? 0) : 0) + amount;
    record.xp_today_date = today;
    // Mirrors the app's level curve: a level every 500 XP.
    record.current_level = Math.floor(Number(record.total_xp) / 500) + 1;

    return record.total_xp;
  },

  grant_achievement: ({ db, userId, args }) => {
    const achievementId = arg(args, "achievement_id") as string;
    const existing = db
      .rows("user_achievements")
      .some((row) => row.user_id === userId && row.achievement_id === achievementId);

    if (existing) return false;

    db.add("user_achievements", {
      user_id: userId,
      achievement_id: achievementId,
      earned_at: new Date().toISOString(),
    });
    return true;
  },

  increment_review_count: ({ db, userId }) => {
    const rows = db.raw("review_streaks");
    let record = rows.find((row) => row.user_id === userId);
    if (!record) {
      record = { user_id: userId, current_streak: 0, longest_streak: 0, reviews_today: 0 };
      rows.push(record);
    }
    record.reviews_today = Number(record.reviews_today ?? 0) + 1;
    return record.reviews_today;
  },

  increment_listen_play_count: ({ db, args }) => {
    const episodeId = arg(args, "episode_id") as string;
    const rows = db.raw("listen_episodes");
    const episode = rows.find((row) => row.id === episodeId);
    if (!episode) return null;
    episode.play_count = Number(episode.play_count ?? 0) + 1;
    return episode.play_count;
  },

  record_checkpoint: ({ db, userId, args }) => {
    const index = Number(arg(args, "index") ?? 0);
    const score = Number(arg(args, "score") ?? 0);
    const rows = db.raw("user_checkpoint_progress");

    let record = rows.find((row) => row.user_id === userId && row.checkpoint_index === index);
    if (!record) {
      record = { user_id: userId, checkpoint_index: index, best_score: 0, attempts: 0 };
      rows.push(record);
    }
    record.attempts = Number(record.attempts ?? 0) + 1;
    record.best_score = Math.max(Number(record.best_score ?? 0), score);
    record.completed_at = new Date().toISOString();

    return record.best_score;
  },

  increment_usage_counter: ({ db, userId, args }) => {
    const key = arg(args, "key") as string;
    const amount = Number(arg(args, "amount") ?? 1);
    const target = (arg(args, "user_id") as string | undefined) ?? userId;
    const today = new Date().toISOString().slice(0, 10);
    const rows = db.raw("usage_counters");

    let record = rows.find(
      (row) => row.user_id === target && row.key === key && row.day === today,
    );
    if (!record) {
      record = { user_id: target, key, day: today, count: 0 };
      rows.push(record);
    }
    record.count = Number(record.count ?? 0) + amount;
    return record.count;
  },

  increment_new_card_count: ({ db, userId, args }) => {
    const amount = Number(arg(args, "amount") ?? 1);
    const today = new Date().toISOString().slice(0, 10);
    const rows = db.raw("daily_new_card_counts");

    let record = rows.find((row) => row.user_id === userId && row.day === today);
    if (!record) {
      record = { user_id: userId, day: today, count: 0 };
      rows.push(record);
    }
    record.count = Number(record.count ?? 0) + amount;
    return record.count;
  },

  verify_invite_code: ({ db, args }) => {
    const code = String(arg(args, "code") ?? "").toUpperCase();
    const invite = db
      .rows("invite_codes")
      .find((row) => String(row.code ?? "").toUpperCase() === code);

    if (!invite) return false;

    // A code is disabled by expiring it or by exhausting its uses — there is no
    // is_active column on invite_codes.
    const expiresAt = invite.expires_at as string | null | undefined;
    if (expiresAt && new Date(expiresAt) < new Date()) return false;

    const max = invite.max_uses as number | null | undefined;
    if (max !== null && max !== undefined && Number(invite.uses ?? 0) >= max) return false;

    return true;
  },

  redeem_invite_code: ({ db, userId, args }) => {
    const code = String(arg(args, "code") ?? "").toUpperCase();
    const rows = db.raw("invite_codes");
    const invite = rows.find((row) => String(row.code ?? "").toUpperCase() === code);
    if (!invite) return false;

    invite.uses = Number(invite.uses ?? 0) + 1;
    db.add("invite_redemptions", {
      invite_code_id: invite.id,
      user_id: userId,
      redeemed_at: new Date().toISOString(),
    });
    return true;
  },

  has_redeemed_invite: ({ db, userId }) =>
    db.rows("invite_redemptions").some((row) => row.user_id === userId),
};

export interface RpcResult {
  status: number;
  body: unknown;
}

export function callRpc(
  name: string,
  context: RpcContext,
  overrides: Record<string, RpcHandler> = {},
): RpcResult {
  const handler = overrides[name] ?? defaultRpcs[name];

  if (!handler) {
    // Loud, not null. A null return would make the caller look like it got a
    // legitimate "no" — which is exactly how the previous double hid the fact
    // that no role check in the app was being exercised.
    return {
      status: 404,
      body: {
        code: "PGRST202",
        message: `Could not find the function public.${name} in the schema cache`,
        details:
          `The in-memory backend has no implementation for this RPC. Add one in ` +
          `src/test/support/server/rpc.ts, or pass an override for this test.`,
        hint: null,
      },
    };
  }

  try {
    return { status: 200, body: handler(context) as Row };
  } catch (error) {
    // A Postgres function that raises returns an error to the client rather
    // than tearing down the request, so a test making an RPC fail — by throwing
    // from an override — should see the app's error branch, not an unhandled
    // exception in the transport.
    return {
      status: 400,
      body: {
        code: "P0001",
        message: error instanceof Error ? error.message : String(error),
        details: null,
        hint: null,
      },
    };
  }
}
