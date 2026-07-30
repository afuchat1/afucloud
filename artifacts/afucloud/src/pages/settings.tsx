import { useState } from 'react';
import { useGetMe, useUpdateProfile } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { User, Mail, Shield } from 'lucide-react';

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: user, isLoading } = useGetMe();
  const updateMutation = useUpdateProfile();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // Pre-fill when data loads
  if (user && name === '' && email === '') {
    setName(user.name || '');
    setEmail(user.email || '');
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      { data: { name } },
      {
        onSuccess: () => toast({ title: 'Saved', description: 'Profile updated successfully' }),
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
      }
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage your account and preferences" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Profile */}
          <section className="rounded-lg border border-card-border bg-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <User className="h-4 w-4 text-primary" strokeWidth={2} />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Profile</h2>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={email} disabled type="email" className="opacity-60 cursor-not-allowed" />
                <p className="text-xs text-muted-foreground">Email cannot be changed at this time.</p>
              </div>
              <Button type="submit" disabled={updateMutation.isPending || isLoading}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </form>
          </section>

          {/* Security */}
          <section className="rounded-lg border border-card-border bg-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Shield className="h-4 w-4 text-primary" strokeWidth={2} />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Security</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Password management and two-factor authentication coming soon.
            </p>
          </section>
        </div>

        {/* Account info */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-card-border bg-card p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{user?.name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{user?.email || '—'}</p>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
