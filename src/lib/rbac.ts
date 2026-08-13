import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type ManagedRole =
  | "bible_reader"
  | "content_reviewer"
  | "beta_tester"
  | "complimentary";

export const MANAGED_ROLES: ManagedRole[] = [
  "bible_reader",
  "content_reviewer",
  "beta_tester",
  "complimentary",
];

export const ROLE_LABELS: Record<ManagedRole, string> = {
  bible_reader: "Bible reader",
  content_reviewer: "Content reviewer",
  beta_tester: "Beta tester",
  // Full All-In access with no payment — investors, partners, press.
  complimentary: "Complimentary (All-In, free)",
};


const CONTENT_REVIEWER_ALLOWED_ADMIN_PREFIXES = [
  "/admin/videos",
  "/admin/set-phrases",
  "/admin/dialect-rules",
];

export function canAccessContentReviewerAdminPath(pathname: string): boolean {
  if (pathname === "/admin") return true;

  return CONTENT_REVIEWER_ALLOWED_ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function hasBibleAccessFromRoles(roles: Iterable<AppRole>): boolean {
  const roleSet = new Set(roles);

  if (roleSet.has("admin")) return true;

  return roleSet.has("bible_reader") && !roleSet.has("content_reviewer");
}
