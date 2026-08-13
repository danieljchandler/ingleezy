import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useAuth } from "./useAuth";
import {
  useDeleteConversation,
  useRenameConversation,
  useSaveConversation,
  useSavedConversations,
} from "./useSavedConversations";

/**
 * Saved Ask AI conversations. The assistant chat is ephemeral by design, so
 * this hook is the entire persistence story: an explicit save (insert), a
 * re-save that updates in place rather than forking a duplicate, and the list
 * ordered newest-first for /saved-chats. The title is derived from the first
 * user message because at save time nobody wants to name a chat.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const aConversation = (over: Record<string, unknown> = {}) => ({
  // Seeds bypass column defaults, so the id is explicit — the rename/delete
  // mutations filter on it.
  id: crypto.randomUUID(),
  user_id: TEST_USER_ID,
  dialect: "Gulf",
  title: "What does yalla mean?",
  seed: { arabic: "يالله" },
  page_context: { route: "/discover", title: "Discover" },
  messages: [
    { role: "user", content: "What does yalla mean?" },
    { role: "assistant", content: "It means let's go." },
  ],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, {
    persona: "free",
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("useSavedConversations", () => {
  it("lists the learner's saved chats, newest first", async () => {
    const { result } = render(
      () => useSavedConversations(),
      (backend) =>
        backend.db.seed("saved_chat_conversations", [
          aConversation({ title: "older", created_at: "2026-08-01T10:00:00Z" }),
          aConversation({ title: "newer", created_at: "2026-08-10T10:00:00Z" }),
        ]),
    );

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data![0].title).toBe("newer");
    expect(result.current.data![1].title).toBe("older");
  });
});

describe("useSaveConversation", () => {
  it("saves a conversation titled after the first user message", async () => {
    const { result, backend } = render(() => ({
      save: useSaveConversation(),
      list: useSavedConversations(),
    }));

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    const row = await result.current.save.mutateAsync({
      dialect: "Gulf",
      seed: { arabic: "يالله" },
      pageContext: { route: "/discover", title: "Discover" },
      messages: [
        { role: "user", content: "What does yalla mean?" },
        { role: "assistant", content: "It means let's go." },
      ],
    });

    expect(row.title).toBe("What does yalla mean?");
    const stored = backend.db.rows("saved_chat_conversations");
    expect(stored).toHaveLength(1);
    expect(stored[0].user_id).toBe(TEST_USER_ID);
  });

  it("re-saving with an id updates in place instead of duplicating", async () => {
    const { result, backend } = render(() => ({
      save: useSaveConversation(),
      auth: useAuth(),
    }));
    await waitFor(() => expect(result.current.auth.user).toBeTruthy());

    const first = await result.current.save.mutateAsync({
      dialect: "Gulf",
      seed: null,
      pageContext: null,
      messages: [{ role: "user", content: "hi" }],
    });

    await result.current.save.mutateAsync({
      id: first.id,
      dialect: "Gulf",
      seed: null,
      pageContext: null,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "أهلاً" },
      ],
    });

    const stored = backend.db.rows("saved_chat_conversations");
    expect(stored).toHaveLength(1);
    expect((stored[0].messages as unknown[]).length).toBe(2);
  });
});

describe("rename and delete", () => {
  it("renames a conversation", async () => {
    let id = "";
    const { result, backend } = render(
      () => ({ rename: useRenameConversation(), auth: useAuth() }),
      (backend) => {
        backend.db.seed("saved_chat_conversations", [aConversation()]);
        id = backend.db.rows("saved_chat_conversations")[0].id as string;
      },
    );
    await waitFor(() => expect(result.current.auth.user).toBeTruthy());

    await result.current.rename.mutateAsync({ id, title: "Yalla, explained" });

    expect(backend.db.rows("saved_chat_conversations")[0].title).toBe("Yalla, explained");
  });

  it("deletes a conversation", async () => {
    let id = "";
    const { result, backend } = render(
      () => ({ del: useDeleteConversation(), auth: useAuth() }),
      (backend) => {
        backend.db.seed("saved_chat_conversations", [aConversation()]);
        id = backend.db.rows("saved_chat_conversations")[0].id as string;
      },
    );
    await waitFor(() => expect(result.current.auth.user).toBeTruthy());

    await result.current.del.mutateAsync(id);

    expect(backend.db.rows("saved_chat_conversations")).toHaveLength(0);
  });
});
