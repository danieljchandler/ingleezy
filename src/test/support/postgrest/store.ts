import { getTable } from "./schema";
import type { Row } from "./types";

/**
 * Reject a fixture row that names a column the table does not have.
 *
 * This is the single most productive check in the test suite. A fixture with an
 * invented column is written happily, then fails the query's filter, and the
 * test reads "no rows" — indistinguishable from a genuine empty state, so it
 * passes while exercising nothing. Nine factories and several spec overrides
 * were wrong this way before it existed.
 *
 * Thrown rather than returned as a PostgREST error: a bad seed is a mistake in
 * the test, not something the app did, so it should surface where it was
 * written.
 */
function assertKnownColumns(table: string, rows: Row[]): void {
  const schema = getTable(table);
  // Tables outside the generated types — `subscribers` and the two
  // service-role-only ones — have nothing to check against.
  if (!schema) return;

  for (const row of rows) {
    const unknown = Object.keys(row).filter((column) => !schema.columns.has(column));
    if (unknown.length === 0) continue;

    throw new Error(
      `Fixture for "${table}" sets ${unknown.map((c) => `"${c}"`).join(", ")}, which ` +
        `${unknown.length === 1 ? "is not a column" : "are not columns"} of that table.\n` +
        `A row with an invented column is stored but never matches a filter, so the ` +
        `test would read as "no rows" rather than failing here.\n` +
        `Columns: ${[...schema.columns].sort().join(", ")}`,
    );
  }
}

/** A write the app performed, as recorded for assertions. */
export interface WriteRecord {
  table: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** Rows sent by the client. Empty for DELETE. */
  payload: Row[];
  /** Rows the operation actually affected, after filtering. */
  affected: Row[];
  at: number;
}

/** A read the app performed, with its filters already parsed. */
export interface ReadRecord {
  table: string;
  /** The raw query string, for debugging a surprising result. */
  search: string;
  at: number;
}

export interface FailureSpec {
  status: number;
  body?: unknown;
  /** Consume after one request; otherwise it applies until cleared. */
  once: boolean;
  /**
   * Which requests to fail. Defaults to all of them.
   *
   * "writes" exists because failing a table outright also fails the read that
   * renders the page, so a test about a *save* failing never gets far enough to
   * click save.
   */
  scope: "all" | "writes" | "reads" | "inserts";
}

/**
 * The in-memory database.
 *
 * Deliberately a plain object store rather than anything SQL-like: the point is
 * to answer PostgREST requests faithfully, not to reimplement Postgres. Writes
 * genuinely mutate it, which is what makes "add a word, see it in the list,
 * reload, still there" expressible — the previous double echoed an empty array
 * for every write, so no test could assert that anything was saved.
 */
export class MemoryDb {
  private tables = new Map<string, Row[]>();
  private failures = new Map<string, FailureSpec>();
  private delays = new Map<string, number>();

  readonly writes: WriteRecord[] = [];
  readonly reads: ReadRecord[] = [];

  /** Replace a table's contents. */
  seed(table: string, rows: Row[]): this {
    assertKnownColumns(table, rows);
    this.tables.set(table, rows.map((row) => ({ ...row })));
    return this;
  }

  /** Seed several tables at once. */
  seedAll(tables: Record<string, Row[]>): this {
    for (const [table, rows] of Object.entries(tables)) this.seed(table, rows);
    return this;
  }

  /** Append without clearing. */
  add(table: string, ...rows: Row[]): this {
    assertKnownColumns(table, rows);
    const existing = this.tables.get(table) ?? [];
    this.tables.set(table, [...existing, ...rows.map((row) => ({ ...row }))]);
    return this;
  }

  /** Current contents, as a copy. Use for assertions on persisted state. */
  rows(table: string): Row[] {
    return (this.tables.get(table) ?? []).map((row) => ({ ...row }));
  }

  has(table: string): boolean {
    return this.tables.has(table);
  }

  /** Live reference, for the executor only. */
  raw(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  // ── Fault injection ────────────────────────────────────────────────────────
  // Error and loading states are a large share of the UI and are almost never
  // covered, because provoking them normally means breaking the backend.

  /** Make the next request touching `table` fail. */
  failNext(table: string, status = 500, body?: unknown): this {
    this.failures.set(table, { status, body, once: true, scope: "all" });
    return this;
  }

  /** Make every request touching `table` fail until cleared. */
  failAlways(table: string, status = 500, body?: unknown): this {
    this.failures.set(table, { status, body, once: false, scope: "all" });
    return this;
  }

  /**
   * Fail only writes to `table`, leaving reads working.
   *
   * This is what a save-failed test needs: failing the table outright also
   * fails the query that renders the page, so the test never reaches the
   * button it means to click.
   */
  failWrites(table: string, status = 500, body?: unknown): this {
    this.failures.set(table, { status, body, once: false, scope: "writes" });
    return this;
  }

  /**
   * Fail only inserts into `table`, leaving reads and deletes working.
   *
   * The case this exists for is the delete-then-reinsert save: the interactive
   * story editor clears a story's scenes and writes the form's back, and
   * failing the whole table means the delete never runs, so the test cannot
   * reach the state where the old scenes are gone and the new ones were
   * refused. That state is the interesting one — it is how a save destroys
   * content — and `failWrites` hides it.
   */
  failInserts(table: string, status = 500, body?: unknown): this {
    this.failures.set(table, { status, body, once: false, scope: "inserts" });
    return this;
  }

  /** Fail only the next write to `table`, so a retry can succeed. */
  failNextWrite(table: string, status = 500, body?: unknown): this {
    this.failures.set(table, { status, body, once: true, scope: "writes" });
    return this;
  }

  clearFailure(table: string): this {
    this.failures.delete(table);
    return this;
  }

  /**
   * Fail an RPC.
   *
   * Not reachable through `failAlways`: a security-definer RPC reads its
   * tables server-side, so failing `user_roles` leaves
   * `admin_list_managed_roles` answering happily. That is faithful to
   * production — the client never issues that read — but it means the only way
   * to exercise "the listing could not load" is to fail the RPC itself.
   * Namespaced into the same map as table failures.
   */
  failRpc(name: string, status = 500, body?: unknown): this {
    this.failures.set(`rpc:${name}`, { status, body, once: false, scope: "all" });
    return this;
  }

  /** Hold responses for `table` open, so loading states are assertable. */
  delay(table: string, ms: number): this {
    this.delays.set(table, ms);
    return this;
  }

  /**
   * The same, for an RPC.
   *
   * Worth having separately because several of the app's gates are RPCs rather
   * than table reads — `has_role` decides what the admin surfaces offer — and a
   * component that acts on a gate before it resolves is a race no table delay
   * can reproduce. Namespaced into the same map so there is one delay
   * mechanism rather than two.
   */
  delayRpc(name: string, ms: number): this {
    this.delays.set(`rpc:${name}`, ms);
    return this;
  }

  /**
   * The same, for an edge function.
   *
   * Several pages gate their whole render on one function — Pricing shows a
   * spinner until `check-subscription` answers — and that branch is only
   * reachable while the call is in flight.
   */
  delayFunction(name: string, ms: number): this {
    this.delays.set(`fn:${name}`, ms);
    return this;
  }

  /** Consumed by the executor; not part of the public test API. */
  takeFailure(table: string, isWrite: boolean, method?: string): FailureSpec | undefined {
    const failure = this.failures.get(table);
    if (!failure) return undefined;

    const applies =
      failure.scope === "all" ||
      (failure.scope === "writes" && isWrite) ||
      (failure.scope === "reads" && !isWrite) ||
      (failure.scope === "inserts" && method === "POST");
    if (!applies) return undefined;

    if (failure.once) this.failures.delete(table);
    return failure;
  }

  delayFor(table: string): number {
    return this.delays.get(table) ?? 0;
  }

  // ── Journals ───────────────────────────────────────────────────────────────

  recordWrite(record: WriteRecord): void {
    this.writes.push(record);
  }

  recordRead(record: ReadRecord): void {
    this.reads.push(record);
  }

  /** Every write to a table, in order. */
  writesTo(table: string): WriteRecord[] {
    return this.writes.filter((write) => write.table === table);
  }

  /** The most recent write to a table, or undefined. */
  lastWriteTo(table: string): WriteRecord | undefined {
    return this.writesTo(table).at(-1);
  }

  /** Every read of a table, in order. */
  readsOf(table: string): ReadRecord[] {
    return this.reads.filter((read) => read.table === table);
  }

  resetJournals(): void {
    this.writes.length = 0;
    this.reads.length = 0;
  }
}
