import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, CircleAlert, Copy, Globe2, Plus, RefreshCw,
  ShieldCheck, Trash2, X, ArrowUpRight, LockKeyhole,
} from 'lucide-react';
import { SiCloudflare } from 'react-icons/si';
import { API_BASE } from '@/lib/api-base';
import { customFetchResponse } from '@workspace/api-client-react';
import { useAutoConfigureDomainVerification, useDisconnectCloudflare, useGetCloudflareConnection, useListCloudflareZones, useStartCloudflareAuthorization } from '@workspace/api-client-react';
import { Link } from 'wouter';
const headers = () => ({
  'Content-Type': 'application/json',
});

type Hostname = {
  id: string; hostname: string; service: string; serviceId?: string | null;
  status: string; sslStatus: string; dnsStatus: string;
  dnsRecord: { type: string; name: string; value: string };
};
type Domain = {
  id: string; hostname: string; verificationStatus: string; sslStatus: string;
  dnsStatus: string; verifiedAt?: string | null;
  dnsRecord: { type: string; name: string; fqdn: string; value: string };
  hostnames: Hostname[];
};

async function jsonFetch(path: string, init?: RequestInit) {
  const res = await customFetchResponse(`${API_BASE}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
       ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200')}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
      {children}
    </span>
  );
}

export default function DomainsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [domainName, setDomainName] = useState('');
  const [selected, setSelected] = useState<Domain | null>(null);
  const [hostnameOpen, setHostnameOpen] = useState(false);
  const [hostnameLabel, setHostnameLabel] = useState('');
  const [hostnameService, setHostnameService] = useState('cdn');
  const [busy, setBusy] = useState<string | null>(null);
  const connection = useGetCloudflareConnection();
  const zones = useListCloudflareZones({ query: { enabled: !!connection.data?.connected, queryKey: ['/api/v1/cloudflare/zones'] } });
  const startAuthorization = useStartCloudflareAuthorization();
  const disconnectCloudflare = useDisconnectCloudflare();
  const autoConfigure = useAutoConfigureDomainVerification();

  const { data: domains = [], isLoading } = useQuery<Domain[]>({
    queryKey: ['domains'],
    queryFn: () => jsonFetch('/v1/domains'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['domains'] });

  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key);
    try { await action(); await refresh(); toast({ title: success }); }
    catch (error) { toast({ title: 'Action failed', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' }); }
    finally { setBusy(null); }
  };

  const addDomain = async (event: React.FormEvent) => {
    event.preventDefault();
    await run('add', async () => {
      const created = await jsonFetch('/v1/domains', { method: 'POST', body: JSON.stringify({ hostname: domainName }) });
      setSelected(created);
      setDomainName('');
      setAddOpen(false);
    }, 'Domain added');
  };

  const verifyDomain = (domain: Domain) => run(`verify-${domain.id}`, async () => {
    const updated = await jsonFetch(`/v1/domains/${domain.id}/verify`, { method: 'POST' });
    setSelected(updated);
  }, 'Domain verification checked');

  const addHostname = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    await run('hostname-add', async () => {
      await jsonFetch(`/v1/domains/${selected.id}/hostnames`, {
        method: 'POST',
        body: JSON.stringify({ label: hostnameLabel, service: hostnameService }),
      });
      setHostnameLabel('');
      setHostnameOpen(false);
    }, 'Hostname added');
  };

  const verifyHostname = (domain: Domain, hostname: Hostname) => run(`hostname-${hostname.id}`, async () => {
    try {
      const updated = await jsonFetch(`/v1/domains/${domain.id}/hostnames/${hostname.id}/verify`, { method: 'POST' });
      setSelected(prev => prev ? { ...prev, hostnames: prev.hostnames.map(item => item.id === hostname.id ? updated : item) } : prev);
    } catch (error) {
      await refresh();
      const latestDomain = queryClient.getQueryData<Domain[]>(['domains'])?.find(item => item.id === domain.id);
      if (latestDomain) setSelected(latestDomain);
      throw error;
    }
      }, 'Hostname status checked');

  const removeHostname = (domain: Domain, hostname: Hostname) => {
    if (!confirm(`Remove ${hostname.hostname}?`)) return;
    run(`delete-hostname-${hostname.id}`, async () => {
      await jsonFetch(`/v1/domains/${domain.id}/hostnames/${hostname.id}`, { method: 'DELETE' });
      if (selected?.id === domain.id) setSelected(prev => prev ? { ...prev, hostnames: prev.hostnames.filter(item => item.id !== hostname.id) } : prev);
    }, 'Hostname removed');
  };

  const removeDomain = (domain: Domain) => {
    if (!confirm(`Remove ${domain.hostname}?`)) return;
    run(`delete-${domain.id}`, async () => {
      await jsonFetch(`/v1/domains/${domain.id}`, { method: 'DELETE' });
      if (selected?.id === domain.id) setSelected(null);
    }, 'Domain removed');
  };

  const copy = (value: string) => {
    navigator.clipboard.writeText(value);
    toast({ title: 'Copied to clipboard' });
  };

  const connectCloudflare = async () => {
    try {
      const result = await startAuthorization.mutateAsync();
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast({ title: 'Could not start Cloudflare authorization', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    }
  };

  const configureOwnership = async (domain: Domain) => {
    try {
      const result = await autoConfigure.mutateAsync({ domainId: domain.id });
      await Promise.all([refresh(), connection.refetch()]);
      toast({ title: result.created ? 'Ownership record configured' : 'Ownership record checked', description: result.message });
    } catch (error) {
      toast({ title: 'Could not configure ownership record', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Cloudflare? DNS management will be unavailable until you reconnect. Existing DNS records are not removed.')) return;
    try {
      await disconnectCloudflare.mutateAsync();
      await Promise.all([connection.refetch(), zones.refetch()]);
      toast({ title: 'Cloudflare disconnected' });
    } catch (error) {
      toast({ title: 'Could not disconnect Cloudflare', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Domains"
        description="Connect Cloudflare, verify ownership, and manage DNS for domains you control."
        actions={<Button className="gap-2" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />Add domain</Button>}
      />

      <section className="overflow-hidden rounded-xl border border-card-border bg-card" data-testid="cloudflare-connection">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-4">
            <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F38020]/10 text-[#F38020]">
              <SiCloudflare className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">DNS provider</p>
              <h2 className="mt-1 text-lg font-semibold">Cloudflare connection</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">AfuCloud uses your authorization to write DNS records only to zones you can access. No API tokens are shown or stored in your browser.</p>
              {connection.data?.connected && <div className="mt-3 flex flex-wrap gap-2" data-testid="cloudflare-connected-status">
                <Status ok>Connected</Status>
                {connection.data.expiresAt && <span className="text-xs text-muted-foreground">Authorization expires {new Date(connection.data.expiresAt).toLocaleDateString()}</span>}
                {!!connection.data.scopes?.length && <span className="text-xs text-muted-foreground">Scopes: {connection.data.scopes.join(', ')}</span>}
              </div>}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {connection.data?.connected ? <>
              <Button variant="outline" onClick={() => connection.refetch()} disabled={connection.isFetching} data-testid="refresh-cloudflare-zones"><RefreshCw className="mr-2 h-4 w-4" />Refresh zones</Button>
              <Button variant="outline" onClick={disconnect} disabled={disconnectCloudflare.isPending} data-testid="disconnect-cloudflare">{disconnectCloudflare.isPending ? 'Disconnecting…' : 'Disconnect'}</Button>
            </> : <Button onClick={connectCloudflare} disabled={startAuthorization.isPending} data-testid="connect-cloudflare">
              <SiCloudflare aria-hidden="true" className="mr-2 h-4 w-4 text-[#F38020]" />{startAuthorization.isPending ? 'Starting…' : 'Connect Cloudflare'}
            </Button>}
          </div>
        </div>
        {connection.data?.connected && <div className="border-t border-border bg-muted/30 px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accessible zones</p>
              {zones.isLoading ? <p className="mt-1 text-sm text-muted-foreground">Loading Cloudflare zones…</p>
                : zones.isError ? <div className="mt-1 flex items-center gap-2 text-sm text-destructive"><span>Could not load zones.</span><button className="underline" onClick={() => zones.refetch()}>Retry</button></div>
                : !zones.data?.length ? <p className="mt-1 text-sm text-muted-foreground">No accessible zones found for this connection.</p>
                : <p className="mt-1 text-sm text-muted-foreground">{zones.data.length} zone{zones.data.length === 1 ? '' : 's'} available · {zones.data.map(zone => zone.name).join(', ')}</p>}
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1"><LockKeyhole className="h-3.5 w-3.5" />OAuth authorization</span>
          </div>
        </div>}
        {connection.isLoading && <div className="animate-pulse border-t border-border px-5 py-4 text-sm text-muted-foreground" data-testid="cloudflare-loading">Checking connection status…</div>}
        {connection.isError && <div className="border-t border-border px-5 py-3 text-sm text-destructive" data-testid="cloudflare-connection-error">Connection status unavailable. <button className="underline" onClick={() => connection.refetch()}>Retry</button></div>}
      </section>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(item => <div key={item} className="h-36 animate-pulse rounded-lg border border-card-border bg-card" />)}
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <Globe2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <h2 className="mt-4 font-semibold">No domains connected</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add a root domain to use it with CDN and future AfuCloud services.</p>
          <Button className="mt-5 gap-2" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />Add your first domain</Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {domains.map(domain => (
            <div key={domain.id} className="rounded-lg border border-card-border bg-card p-5">
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><Globe2 className="h-5 w-5 text-primary" /></div>
                  <div className="min-w-0">
                    <h2 className="break-all font-semibold">{domain.hostname}</h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Status ok={domain.verificationStatus === 'verified'}>{domain.verificationStatus === 'verified' ? 'Verified' : 'Verification pending'}</Status>
                      <Status ok={domain.sslStatus === 'active'}>{domain.sslStatus === 'active' ? 'SSL Active' : 'SSL pending'}</Status>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => removeDomain(domain)} disabled={busy === `delete-${domain.id}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">{domain.hostnames.length} hostname{domain.hostnames.length === 1 ? '' : 's'} connected</span>
                <div className="flex gap-2">
                  <Link href={`/domains/${domain.id}/dns`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent" data-testid={`manage-dns-${domain.id}`}>DNS records<ArrowUpRight className="h-3.5 w-3.5" /></Link>
                  <Button variant="outline" size="sm" onClick={() => setSelected(domain)}>Manage</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-lg p-4 sm:p-6">
          <DialogHeader><DialogTitle>Add a root domain</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={addDomain}>
            <div className="space-y-2"><Label htmlFor="domain-name">Root domain</Label><Input id="domain-name" value={domainName} onChange={event => setDomainName(event.target.value)} placeholder="example.com" required /></div>
            <p className="text-xs leading-relaxed text-muted-foreground">A TXT record will be generated for <code>_afu-verification</code>. You can add it at your DNS provider, then return here to verify ownership.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="submit" disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add domain'}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] max-w-3xl overflow-x-hidden overflow-y-auto p-4 sm:max-h-[90vh] sm:p-6">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex min-w-0 items-center gap-2 break-all"><Globe2 className="h-5 w-5 shrink-0 text-primary" />{selected.hostname}</DialogTitle>
              </DialogHeader>
              <div className="min-w-0 space-y-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-card-border bg-card p-3"><p className="text-xs text-muted-foreground">Ownership</p><div className="mt-1"><Status ok={selected.verificationStatus === 'verified'}>{selected.verificationStatus === 'verified' ? 'Verified' : 'Pending'}</Status></div></div>
                  <div className="rounded-lg border border-card-border bg-card p-3"><p className="text-xs text-muted-foreground">SSL/TLS</p><div className="mt-1"><Status ok={selected.sslStatus === 'active'}>{selected.sslStatus === 'active' ? 'Active' : 'Pending'}</Status></div></div>
                  <div className="rounded-lg border border-card-border bg-card p-3"><p className="text-xs text-muted-foreground">DNS</p><div className="mt-1"><Status ok={selected.dnsStatus === 'configured'}>{selected.dnsStatus === 'configured' ? 'Configured' : 'Pending'}</Status></div></div>
                </div>

                {selected.verificationStatus !== 'verified' && (
                  <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/40">
                    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row"><div><h3 className="font-medium text-amber-900 dark:text-amber-100">Verify domain ownership</h3><p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">Configure the AfuCloud verification TXT record in Cloudflare, or add it manually with your DNS provider.</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => configureOwnership(selected)} disabled={!connection.data?.connected || autoConfigure.isPending} data-testid="auto-configure-ownership">{autoConfigure.isPending ? 'Configuring…' : 'Configure in Cloudflare'}</Button><Button size="sm" variant="outline" onClick={() => verifyDomain(selected)} disabled={busy === `verify-${selected.id}`} className="gap-1.5" data-testid="verify-domain"><RefreshCw className="h-3.5 w-3.5" />{busy === `verify-${selected.id}` ? 'Checking…' : 'Check DNS'}</Button></div></div>
                    {!connection.data?.connected && <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">Connect Cloudflare above to configure the record automatically.</p>}
                    <div className="mt-4 grid min-w-0 gap-2 text-xs sm:grid-cols-[100px_1fr]"><span className="text-muted-foreground">Type</span><code>TXT</code><span className="text-muted-foreground">Name</span><code>_afu-verification</code><span className="text-muted-foreground">Value</span><div className="flex min-w-0 items-center gap-2"><code className="min-w-0 break-all">{selected.dnsRecord.value}</code><Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => copy(selected.dnsRecord.value)}><Copy className="h-3 w-3" /></Button></div></div>
                  </section>
                )}

                <section>
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><h3 className="font-semibold">Hostnames</h3><p className="text-xs text-muted-foreground">Connect subdomains to AfuCloud services without re-verifying the root domain.</p></div>
                    <div className="flex flex-wrap gap-2">
                      {selected.verificationStatus === 'verified' && selected.hostnames.some(hostname => hostname.service === 'cdn') && <Link href={`/domains/${selected.id}/dns`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent" data-testid={`configure-hostname-dns-${selected.id}`}>Configure CDN DNS<ArrowUpRight className="h-3.5 w-3.5" /></Link>}
                      <Button size="sm" className="gap-1.5" disabled={selected.verificationStatus !== 'verified'} onClick={() => setHostnameOpen(true)}><Plus className="h-3.5 w-3.5" />Add hostname</Button>
                    </div>
                  </div>
                  {selected.hostnames.some(hostname => hostname.service === 'cdn') && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Configure all registered CDN CNAMEs from the DNS records page in one action. Existing conflicting records are left unchanged; certificate setup remains separate.</p>}
                 {selected.hostnames.length === 0 ? <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No hostnames configured yet.</div> : <div className="space-y-2">{selected.hostnames.map(hostname => <div key={hostname.id} className="rounded-lg border border-card-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{hostname.hostname}</p><div className="mt-1 flex flex-wrap gap-1.5"><Status ok={hostname.status === 'active'}>{hostname.status === 'active' ? 'Active' : hostname.dnsStatus === 'configured' ? 'TLS pending' : 'DNS pending'}</Status><Status ok={hostname.sslStatus === 'active'}>{hostname.sslStatus === 'active' ? 'SSL Active' : 'SSL pending'}</Status><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{hostname.service}</span></div></div><div className="flex items-center gap-1"><Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => verifyHostname(selected, hostname)} disabled={busy === `hostname-${hostname.id}`}><RefreshCw className="h-3 w-3" />Check status</Button><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeHostname(selected, hostname)}><X className="h-4 w-4" /></Button></div></div><div className="mt-3 flex items-center gap-2 rounded bg-muted/50 px-3 py-2 text-xs"><span className="text-muted-foreground">CNAME</span><code className="truncate">{hostname.dnsRecord.value}</code><Button variant="ghost" size="icon" className="ml-auto h-6 w-6 shrink-0" onClick={() => copy(hostname.dnsRecord.value)}><Copy className="h-3 w-3" /></Button></div>{hostname.dnsStatus === 'configured' && hostname.sslStatus !== 'active' && <p className="mt-2 text-xs text-muted-foreground">DNS is correct. Complete hostname and TLS setup in Cloudflare, then check status again.</p>}</div>)}</div>}
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={hostnameOpen} onOpenChange={setHostnameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add hostname under {selected?.hostname}</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={addHostname}>
            <div className="space-y-2"><Label htmlFor="hostname-label">Hostname label</Label><div className="flex items-center gap-2"><Input id="hostname-label" value={hostnameLabel} onChange={event => setHostnameLabel(event.target.value)} placeholder="cdn" required /><span className="text-sm text-muted-foreground">.{selected?.hostname}</span></div></div>
            <div className="space-y-2"><Label htmlFor="hostname-service">Connected service</Label><select id="hostname-service" value={hostnameService} onChange={event => setHostnameService(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="cdn">AfuCloud CDN</option><option value="storage">AfuCloud Storage</option><option value="api">AfuCloud API</option><option value="unconnected">Unconnected</option></select></div>
            <p className="text-xs text-muted-foreground">For CDN hostnames, open DNS records and configure all missing CNAMEs in one action. Existing conflicting records are never overwritten; Cloudflare hostname and TLS setup is separate.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setHostnameOpen(false)}>Cancel</Button><Button type="submit" disabled={busy === 'hostname-add'}>{busy === 'hostname-add' ? 'Adding…' : 'Add hostname'}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}