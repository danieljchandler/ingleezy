import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDeleteConversation,
  useRenameConversation,
  useSavedConversations,
  type SavedConversation,
} from "@/hooks/useSavedConversations";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { toast } from "sonner";
import { Check, Loader2, MessageSquare, Pencil, Sparkles, Trash2, X } from "lucide-react";

/**
 * The saved Ask AI conversations. Opening one loads it back into the global
 * assistant panel, where it can be continued (and re-saved).
 */
const SavedChats = () => {
  const { data: conversations, isLoading } = useSavedConversations();
  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const { loadConversation } = useAiAssistant();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const openConversation = (row: SavedConversation) => {
    loadConversation({
      id: row.id,
      seed: row.seed,
      messages: Array.isArray(row.messages) ? row.messages : [],
    });
  };

  const startRename = (row: SavedConversation) => {
    setRenamingId(row.id);
    setRenameValue(row.title);
  };

  const submitRename = () => {
    const id = renamingId;
    const title = renameValue.trim();
    setRenamingId(null);
    if (!id || !title) return;
    renameConversation.mutate(
      { id, title },
      { onError: () => toast.error("تعذّرت إعادة التسمية") },
    );
  };

  const confirmDelete = () => {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    if (!id) return;
    deleteConversation.mutate(id, {
      onSuccess: () => toast.success("انحذفت"),
      onError: () => toast.error("تعذّر الحذف"),
    });
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <PageCorner />
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Sparkles className="h-5 w-5 text-primary" />
            المحادثات المحفوظة
          </h1>
          <div className="w-9" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !conversations || conversations.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <MessageSquare className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">ما فيه محادثات محفوظة</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                When an Ask AI conversation is worth keeping, tap Save in the chat panel and it
                will show up here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {conversations.map((row) => (
              <Card key={row.id} className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => openConversation(row)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {renamingId === row.id ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="h-7 text-sm"
                      />
                    ) : (
                      <p className="truncate text-sm font-medium">{row.title}</p>
                    )}
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.dialect}
                      {row.page_context?.title ? ` · ${row.page_context.title}` : ""}
                      {" · "}
                      {new Date(row.created_at).toLocaleDateString()}
                    </p>
                  </button>
                  {renamingId === row.id ? (
                    <>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={submitRename} aria-label="أكّد التسمية">
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRenamingId(null)} aria-label="ألغِ التسمية">
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => startRename(row)}
                        aria-label="أعد تسمية المحادثة"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDeleteId(row.id)}
                        disabled={deleteConversation.isPending}
                        aria-label="احذف المحادثة"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>نحذف هذي المحادثة؟</AlertDialogTitle>
            <AlertDialogDescription>
              It will be gone for good — saved chats aren't recoverable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>احذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default SavedChats;
