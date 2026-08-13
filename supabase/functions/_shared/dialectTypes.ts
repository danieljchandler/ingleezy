// The Dialect type on its own, with no imports.
//
// dialectHelpers.ts pulls in the Supabase client and reads Deno.env, so anything
// that type-imports Dialect from there drags a Deno-only module into the
// frontend's TypeScript program. Pure modules (msaLeakDetector, and the *Core
// files the Vitest suite exercises) import it from here instead;
// dialectHelpers re-exports it so every existing import path still works.

export type Dialect = 'Gulf' | 'Egyptian' | 'Yemeni' | string;
