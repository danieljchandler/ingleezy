import { describe, expect, it } from "vitest";
import { canAccessContentReviewerAdminPath } from "./rbac";

describe("rbac helpers", () => {
  it("allows content reviewers on approved admin content paths only", () => {
    expect(canAccessContentReviewerAdminPath("/admin")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/videos")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/videos/123/edit")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/set-phrases")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/dialect-rules")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/curriculum-builder")).toBe(false);
  });
});
