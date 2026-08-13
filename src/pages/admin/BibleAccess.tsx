import { useState, useEffect, useCallback } from "react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Shield, Search } from "lucide-react";
import { MANAGED_ROLES, ROLE_LABELS, type ManagedRole } from "@/lib/rbac";

interface ManagedRoleRow {
  id: string;
  user_id: string;
  role: ManagedRole;
  created_at: string;
  email: string | null;
}

const BibleAccess = () => {
  const { isAdmin } = useAdminAuth();
  const [rows, setRows] = useState<ManagedRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [selectedRole, setSelectedRole] = useState<ManagedRole>("bible_reader");
  const [filterRole, setFilterRole] = useState<ManagedRole | "all">("all");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_list_managed_roles");
      if (error) throw error;
      setRows((data ?? []) as ManagedRoleRow[]);
    } catch (err) {
      console.error("Error fetching managed roles:", err);
      toast.error("Failed to load role assignments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const addRole = async () => {
    const rawIdentifier = identifier.trim();
    if (!rawIdentifier) return;
    setAdding(true);

    try {
      const { data: resolved, error: resolveError } = await supabase.rpc(
        "admin_find_user",
        { _identifier: rawIdentifier }
      );
      if (resolveError) throw resolveError;

      const resolvedUser = (resolved ?? [])[0] as { user_id: string; email: string | null } | undefined;
      if (!resolvedUser?.user_id) {
        toast.error("User not found", {
          description: "Enter a valid account email or user UUID.",
        });
        return;
      }

      const { data: existing, error: existingError } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", resolvedUser.user_id)
        .eq("role", selectedRole)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing) {
        toast.info("This role is already assigned to that user.");
        return;
      }

      const { error: insertError } = await supabase
        .from("user_roles")
        .insert({ user_id: resolvedUser.user_id, role: selectedRole });

      if (insertError) throw insertError;

      toast.success(`${ROLE_LABELS[selectedRole]} granted`);
      setIdentifier("");
      await fetchRoles();
    } catch (err) {
      console.error("Error adding role:", err);
      toast.error("Failed to grant role", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setAdding(false);
    }
  };

  const removeRole = async (roleRowId: string) => {
    setRemovingId(roleRowId);
    try {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleRowId);
      if (error) throw error;

      setRows((prev) => prev.filter((r) => r.id !== roleRowId));
      toast.success("Role revoked");
    } catch (err) {
      console.error("Error revoking role:", err);
      toast.error("Failed to revoke role");
    } finally {
      setRemovingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Only admins can manage role access.
      </div>
    );
  }

  const visibleRows = filterRole === "all" ? rows : rows.filter((row) => row.role === filterRole);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-primary/10 p-2">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Role Access Management</h1>
          <p className="text-sm text-muted-foreground">
            Grant and revoke Bible reader, content reviewer, beta tester, and complimentary (free All-In) roles.
          </p>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_220px_auto]">
        <Input
          placeholder="User email or UUID"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addRole()}
        />
        <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as ManagedRole)}>
          <SelectTrigger>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            {MANAGED_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={addRole} disabled={adding || !identifier.trim()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span className="ml-1">Add</span>
        </Button>
      </div>

      <div className="w-[220px]">
        <Select value={filterRole} onValueChange={(value) => setFilterRole(value as ManagedRole | "all")}>
          <SelectTrigger>
            <SelectValue placeholder="Filter role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All managed roles</SelectItem>
            {MANAGED_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No matching role assignments.</p>
          <p className="text-xs mt-1">Add users above to grant access.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>User ID</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge variant="outline">{ROLE_LABELS[row.role]}</Badge>
                </TableCell>
                <TableCell className="text-sm">{row.email ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{row.user_id}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(row.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    disabled={removingId === row.id}
                    onClick={() => removeRole(row.id)}
                  >
                    {removingId === row.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-xs text-muted-foreground">
        Admin users always keep full access and do not need extra role assignments.
      </p>
    </div>
  );
};

export default BibleAccess;
