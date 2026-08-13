/**
 * PostgREST error bodies, reproduced exactly.
 *
 * The exactness matters more than it looks. supabase-js keys behaviour off
 * specific codes — `.maybeSingle()` returns `{data: null, error: null}` only
 * when it sees `PGRST116`, and returns an *error* for anything else. A test
 * double that returns a plausible-looking 404 instead would make maybeSingle
 * appear broken in tests while working in production.
 */

export interface PostgrestErrorBody {
  code: string;
  details: string | null;
  hint: string | null;
  message: string;
}

export const errors = {
  /** `.single()`/`.maybeSingle()` matched a number of rows other than one. */
  notSingle(rowCount: number): PostgrestErrorBody {
    return {
      code: "PGRST116",
      details: `The result contains ${rowCount} rows`,
      hint: null,
      message:
        rowCount === 0
          ? "JSON object requested, multiple (or no) rows returned"
          : "JSON object requested, multiple (or no) rows returned",
    };
  },

  /** An embed named a relationship that does not exist. */
  noRelationship(table: string, related: string): PostgrestErrorBody {
    return {
      code: "PGRST200",
      details: `Searched for a foreign key relationship between '${table}' and '${related}' in the schema 'public', but no matches were found.`,
      hint: null,
      message: `Could not find a relationship between '${table}' and '${related}' in the schema cache`,
    };
  },

  /** The table itself is unknown. */
  undefinedTable(table: string): PostgrestErrorBody {
    return {
      code: "PGRST205",
      details: null,
      hint: null,
      message: `Could not find the table 'public.${table}' in the schema cache`,
    };
  },

  /** A referenced column does not exist on the table. */
  undefinedColumn(table: string, column: string): PostgrestErrorBody {
    return {
      code: "42703",
      details: null,
      hint: null,
      message: `column ${table}.${column} does not exist`,
    };
  },

  /**
   * A write payload named a column the table does not have.
   *
   * PostgREST answers this rather than 42703 for writes, because it checks the
   * payload against its schema cache before reaching Postgres. Reproduced
   * separately so a test that hits it gets the message it would really get.
   */
  unknownColumnInPayload(table: string, column: string): PostgrestErrorBody {
    return {
      code: "PGRST204",
      details: null,
      hint: null,
      message: `Could not find the '${column}' column of '${table}' in the schema cache`,
    };
  },

  /** Primary-key collision on insert. */
  uniqueViolation(table: string, column: string): PostgrestErrorBody {
    return {
      code: "23505",
      details: `Key (${column})=(...) already exists.`,
      hint: null,
      message: `duplicate key value violates unique constraint "${table}_pkey"`,
    };
  },

  /** A NOT NULL column was omitted. */
  notNullViolation(table: string, column: string): PostgrestErrorBody {
    return {
      code: "23502",
      details: `Failing row contains a null value in column "${column}".`,
      hint: null,
      message: `null value in column "${column}" of relation "${table}" violates not-null constraint`,
    };
  },
};

/**
 * Thrown when a test issues a query the emulator does not implement.
 *
 * This is the single most important design decision in the double: an
 * unimplemented feature must fail the test, never quietly return every row.
 * The predecessor to this module ignored all query parameters, which meant a
 * test asserting "only the due cards are shown" passed whether or not the app
 * filtered anything. Green tests that prove nothing are worse than no tests.
 */
export class UnsupportedQueryError extends Error {
  constructor(feature: string, detail: string) {
    super(
      `The in-memory PostgREST does not implement ${feature}: ${detail}\n` +
        `Add support in src/test/support/postgrest/ rather than working around it — ` +
        `silently ignoring the clause would make this test pass for the wrong reason.`,
    );
    this.name = "UnsupportedQueryError";
  }
}
