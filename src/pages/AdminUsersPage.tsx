import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Search, MoreHorizontal, ShieldCheck, Shield, Briefcase, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { User, UserRole } from '@/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

async function callEdgeFunction(functionName: string, body: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) return { error: json.error ?? 'Unknown error' };
  return { data: json };
}

const roleConfig: Record<UserRole, { label: string; variant: 'default' | 'secondary' | 'outline'; icon: typeof Shield }> = {
  admin: { label: 'Admin', variant: 'default', icon: ShieldCheck },
  ops: { label: 'Operations', variant: 'secondary', icon: Briefcase },
  sales: { label: 'Sales', variant: 'outline', icon: Shield },
};

function RoleBadge({ role }: { role: UserRole }) {
  const { label, variant, icon: Icon } = roleConfig[role];
  return (
    <Badge variant={variant}>
      <Icon className="mr-1 h-3 w-3" />
      {label}
    </Badge>
  );
}

interface InviteFormState {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  role: UserRole;
}

const defaultInviteForm: InviteFormState = {
  email: '',
  firstName: '',
  lastName: '',
  jobTitle: '',
  role: 'sales',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteFormState>(defaultInviteForm);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const mapped: User[] = (data ?? []).map((row) => ({
        id: row.id,
        name: `${row.first_name} ${row.last_name}`,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        jobTitle: row.job_title,
        role: row.role as UserRole,
        active: row.active,
        createdAt: row.created_at,
      }));
      setUsers(mapped);
    } catch (err) {
      console.error('Failed to load users:', err);
      toast({ title: 'Failed to load users', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.email || !inviteForm.firstName || !inviteForm.lastName || !inviteForm.role) {
      toast({ title: 'All fields are required', variant: 'destructive' });
      return;
    }

    setIsInviting(true);
    try {
      const { error } = await callEdgeFunction('invite-user', {
        email: inviteForm.email,
        first_name: inviteForm.firstName,
        last_name: inviteForm.lastName,
        job_title: inviteForm.jobTitle,
        role: inviteForm.role,
      });

      if (error) {
        toast({ title: 'Invite failed', description: error, variant: 'destructive' });
        return;
      }

      toast({
        title: 'Invite sent',
        description: `An invitation email has been sent to ${inviteForm.email}.`,
      });
      setInviteForm(defaultInviteForm);
      setIsInviteOpen(false);
      await loadUsers();
    } finally {
      setIsInviting(false);
    }
  };

  const handleToggleActive = async (userId: string, active: boolean) => {
    const { error } = await supabase
      .from('users')
      .update({ active })
      .eq('id', userId);

    if (error) {
      toast({ title: 'Failed to update user', description: error.message, variant: 'destructive' });
      return;
    }

    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, active } : u)));
    toast({ title: active ? 'User activated' : 'User deactivated' });
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    const { error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', userId);

    if (error) {
      toast({ title: 'Failed to update role', description: error.message, variant: 'destructive' });
      return;
    }

    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    toast({ title: 'Role updated' });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { error } = await callEdgeFunction('delete-user', { user_id: deleteTarget.id });
      if (error) {
        toast({ title: 'Failed to delete user', description: error, variant: 'destructive' });
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      toast({ title: 'User deleted' });
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = users.filter((u) => u.active).length;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">User Management</h1>
          <p className="mt-1 text-muted-foreground">Manage user accounts and permissions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadUsers} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Invite User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleInvite}>
                <DialogHeader>
                  <DialogTitle className="font-display text-2xl">Invite User</DialogTitle>
                  <DialogDescription>
                    Send an invitation email. The user will set their own password on first login.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-firstName">First Name *</Label>
                      <Input
                        id="invite-firstName"
                        value={inviteForm.firstName}
                        onChange={(e) => setInviteForm((f) => ({ ...f, firstName: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-lastName">Last Name *</Label>
                      <Input
                        id="invite-lastName"
                        value={inviteForm.lastName}
                        onChange={(e) => setInviteForm((f) => ({ ...f, lastName: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email *</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-jobTitle">Job Title</Label>
                    <Input
                      id="invite-jobTitle"
                      value={inviteForm.jobTitle}
                      onChange={(e) => setInviteForm((f) => ({ ...f, jobTitle: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role *</Label>
                    <Select
                      value={inviteForm.role}
                      onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v as UserRole }))}
                    >
                      <SelectTrigger id="invite-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sales">Sales</SelectItem>
                        <SelectItem value="ops">Operations</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter className="mt-6">
                  <Button type="button" variant="outline" onClick={() => setIsInviteOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isInviting}>
                    {isInviting ? 'Sending invite...' : 'Send Invite'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>
                {isLoading ? 'Loading...' : `${activeCount} active of ${users.length} total`}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Users className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No users match your search' : 'No users found'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Joined</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{u.name}</p>
                          <p className="text-sm text-muted-foreground">{u.email}</p>
                          {u.jobTitle && (
                            <p className="text-xs text-muted-foreground">{u.jobTitle}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={u.role} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={u.active}
                            onCheckedChange={(checked) => handleToggleActive(u.id, checked)}
                            disabled={u.id === currentUser?.id}
                          />
                          <span className="text-sm text-muted-foreground">
                            {u.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleRoleChange(u.id, 'sales')}
                              disabled={u.role === 'sales'}
                            >
                              Set role: Sales
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRoleChange(u.id, 'ops')}
                              disabled={u.role === 'ops'}
                            >
                              Set role: Operations
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRoleChange(u.id, 'admin')}
                              disabled={u.role === 'admin'}
                            >
                              Set role: Admin
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(u)}
                              disabled={u.id === currentUser?.id}
                            >
                              Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) and revoke
              their access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
