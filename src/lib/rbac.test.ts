import { describe, expect, it } from "vitest";
import {
  canAccessContentReviewerAdminPath,
  hasBibleAccessFromRoles,
} from "./rbac";

describe("rbac helpers", () => {
  it("allows content reviewers on approved admin content paths only", () => {
    expect(canAccessContentReviewerAdminPath("/admin")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/videos")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/videos/123/edit")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/set-phrases")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/dialect-rules")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/bible-access")).toBe(false);
    expect(canAccessContentReviewerAdminPath("/admin/curriculum-builder")).toBe(false);
  });

  it("denies bible access to content reviewers unless admin", () => {
    expect(hasBibleAccessFromRoles(["bible_reader"])).toBe(true);
    expect(hasBibleAccessFromRoles(["content_reviewer"])).toBe(false);
    expect(hasBibleAccessFromRoles(["content_reviewer", "bible_reader"])).toBe(false);
    expect(hasBibleAccessFromRoles(["admin", "content_reviewer"])).toBe(true);
  });
});
