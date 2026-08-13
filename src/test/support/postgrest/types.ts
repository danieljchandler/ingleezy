/** Shared vocabulary for the in-memory PostgREST implementation. */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A database row. Values are unknown rather than Json so fixtures stay ergonomic. */
export type Row = Record<string, unknown>;

/** Comparison operators PostgREST exposes in the query string. */
export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in"
  | "cs"
  | "cd"
  | "ov";

/** A single `column=op.value` condition, possibly negated by `not.`. */
export interface Condition {
  kind: "condition";
  column: string;
  op: FilterOp;
  value: string;
  negated: boolean;
}

/** `or=(a.eq.1,b.eq.2)` / `and=(...)`, which nest arbitrarily. */
export interface LogicalNode {
  kind: "logical";
  operator: "or" | "and";
  children: FilterNode[];
  negated: boolean;
}

export type FilterNode = Condition | LogicalNode;

/** One entry in a `select=` list. */
export interface SelectField {
  /** Key to emit in the response. Differs from `column` when aliased. */
  alias: string;
  /** Source column, or the related table for an embed. */
  column: string;
  /** `->>`/`->` JSON path segments, if any. */
  jsonPath: string[];
  /** Present when this field embeds a related resource. */
  embed?: EmbeddedSelect;
}

export interface EmbeddedSelect {
  /** Related table name. */
  table: string;
  /** `!inner` drops parents with no matching child. */
  inner: boolean;
  /** `!fk_name` disambiguates when two FKs point at the same table. */
  hint?: string;
  /** `rel(count)` returns an aggregate rather than rows. */
  countOnly: boolean;
  fields: SelectField[];
  filters: FilterNode[];
  order: OrderSpec[];
  limit?: number;
}

export interface OrderSpec {
  column: string;
  ascending: boolean;
  /** PostgREST defaults nulls last for asc, first for desc. */
  nullsFirst: boolean;
}

export type CountMode = "exact" | "planned" | "estimated";

export type ReturnMode = "representation" | "minimal";

/** A parsed request, independent of how it arrived. */
export interface ParsedQuery {
  method: "GET" | "HEAD" | "POST" | "PATCH" | "PUT" | "DELETE";
  table: string;
  fields: SelectField[];
  filters: FilterNode[];
  order: OrderSpec[];
  limit?: number;
  offset?: number;
  count?: CountMode;
  /** `.single()` and `.maybeSingle()` both request this Accept type. */
  single: boolean;
  returning: ReturnMode;
  /** Columns from `on_conflict=`, for upserts. */
  onConflict?: string[];
  /** True for either upsert resolution. */
  upsert: boolean;
  /**
   * True for `resolution=ignore-duplicates` specifically.
   *
   * An existing row is then left untouched *and* left out of the returned
   * representation, so the result set is shorter than the payload. Callers
   * doing bulk saves count the difference to report how many were already
   * there.
   */
  ignoreDuplicates?: boolean;
  body?: Row | Row[];
}

export interface ExecuteResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}
