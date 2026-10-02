import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@/lib/navigation';
import {
  useCreateDomainDnsRecord,
  useAutoConfigureCdnHostnames,
  useDeleteDomainDnsRecord,
  useGetCloudflareConnection,
  useListCloudflareZones,
  useListDomainDnsRecords,
  useUpdateDomainDnsRecord,
  useVerifyDomainDnsRecord,
} from '@workspace/api-client-react';
import type { CloudflareDnsRecord, CloudflareDnsRecordInput, CloudflareDnsVerification } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { API_BASE } from '@/lib/api-base';
import { customFetchResponse } from '@workspace/api-client-react';
import {
  ArrowLeft, CheckCircle2, CircleAlert, Cloud, Copy, Globe2,
  LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, Trash2,
} from 'lucide-react';

type DomainHostname = {
  id: string;
  hostname: string;
  service: string;
  dnsRecord: { type: string; name: string; value: string };
};
type Domain = {
  id: string;
  hostname: string;
  verificationStatus: string;
  dnsStatus: string;
  hostnames: DomainHostname[];
};
const recordTypes = ['A', 'AAAA', 'CAA', 'CERT', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'LOC', 'MX', 'NAPTR', 'NS', 'PTR', 'SMIMEA', 'SRV', 'SSHFP', 'SVCB', 'TLSA', 'TXT', 'URI'];
const headers = { 'Content-Type': 'application/json' };

async function getDomains(): Promise<Domain[]> {
  const response = await customFetchResponse(`${API_BASE}/v1/domains`, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function Badge({ good, children }: { good: boolean; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${good ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'}`}>
    {good ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}{children}
  </span>;
}

type FormState = {
  type: string; name: string; content: string; ttl: string; proxied: boolean;
  priority: string; comment: string; data: string;
};
const emptyForm = (): FormState => ({ type: 'A', name: '', content: '', ttl: '1', proxied: false, priority: '', comment: '', data: '' });

export default function DomainDnsPage() {
  const { domainId = '' } = useParams<{ domainId: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const connection = useGetCloudflareConnection();
  const zones = useListCloudflareZones({
    query: { enabled: !!connection.data?.connected, queryKey: ['/api/v1/cloudflare/zones'] },
  });
  const domains = useQuery({ queryKey: ['domains'], queryFn: getDomains });
  const domain = domains.data?.find(item => item.id === domainId);
  const recordsQuery = useListDomainDnsRecords(domainId, undefined, {
    query: { enabled: !!domainId && !!connection.data?.connected, queryKey: ['/api/v1/domains', domainId, 'dns-records'] },
  });
  const createRecord = useCreateDomainDnsRecord();
  const autoConfigureHostnames = useAutoConfigureCdnHostnames();
  const updateRecord = useUpdateDomainDnsRecord();
  const deleteRecord = useDeleteDomainDnsRecord();
  const verifyRecord = useVerifyDomainDnsRecord();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CloudflareDnsRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<CloudflareDnsRecord | null>(null);
  const [verification, setVerification] = useState<Record<string, CloudflareDnsVerification>>({});
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  const recordList = recordsQuery.data?.records ?? [];
  const cdnHostnames = domain?.hostnames.filter(hostname => hostname.service === 'cdn') ?? [];
  const filtered = useMemo(() => recordList.filter(record =>
    (typeFilter === 'all' || record.type === typeFilter) &&
    (!filter || `${record.name} ${record.content} ${record.comment ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
  ), [recordList, typeFilter, filter]);
  const matchedZone = zones.data?.find(zone => zone.name.toLowerCase() === domain?.hostname.toLowerCase());

  const reloadRecords = async () => {
    await queryClient.invalidateQueries({ queryKey: recordsQuery.queryKey });
  };
  const configureCdnDns = async () => {
    if (!domain || cdnHostnames.length === 0) return;
    try {
      const result = await autoConfigureHostnames.mutateAsync({ domainId });
      setFilter('');
      setTypeFilter('CNAME');
      const [refreshed] = await Promise.all([
        recordsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['domains'] }),
      ]);
      const issues = result.results
        .filter(item => item.status === 'conflict' || item.status === 'failed')
        .map(item => item.hostname);
      const summary = `${result.created} created · ${result.unchanged} already correct · ${result.conflicts} conflicts · ${result.failed} failed.`;
      const issueNames = issues.length ? ` No changes were made to: ${issues.join(', ')}.` : '';
      toast({
        title: refreshed.isError ? 'DNS configured; records could not be refreshed' : 'CDN hostname DNS configured',
        description: `${summary}${issueNames}${refreshed.isError ? ' Use Refresh DNS records to reload the list.' : ''}`,
        ...(result.conflicts > 0 || result.failed > 0 || refreshed.isError ? { variant: 'destructive' as const } : {}),
      });
    } catch (error) {
      toast({
        title: 'Could not configure CDN hostname DNS',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    }
  };
  const openCreate = () => { setEditing(null); setForm(emptyForm()); setEditorOpen(true); };
  const openEdit = (record: CloudflareDnsRecord) => {
    setEditing(record);
    setForm({
      type: record.type, name: record.name, content: record.content, ttl: String(record.ttl ?? 1),
      proxied: !!record.proxied, priority: record.priority == null ? '' : String(record.priority),
      comment: record.comment ?? '', data: record.data ? JSON.stringify(record.data, null, 2) : '',
    });
    setEditorOpen(true);
  };

  const saveRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    let data: Record<string, unknown> | undefined;
    try { data = form.data.trim() ? JSON.parse(form.data) : undefined; }
    catch { toast({ title: 'Record data must be valid JSON', variant: 'destructive' }); return; }
    const input: CloudflareDnsRecordInput = {
      type: form.type, name: form.name.trim(), content: form.content.trim() || undefined,
      ttl: Number(form.ttl), proxied: ['A', 'AAAA', 'CNAME'].includes(form.type) ? form.proxied : undefined,
      priority: form.priority.trim() ? Number(form.priority) : undefined,
      comment: form.comment.trim() || undefined, data,
    };
    setSaving(true);
    try {
      if (editing) await updateRecord.mutateAsync({ domainId, recordId: editing.id, data: input });
      else await createRecord.mutateAsync({ domainId, data: input });
      await reloadRecords();
      setEditorOpen(false);
      toast({ title: editing ? 'DNS record updated' : 'DNS record created' });
    } catch (error) {
      toast({ title: 'Could not save DNS record', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRecord.mutateAsync({ domainId, recordId: deleting.id });
      await reloadRecords();
      toast({ title: 'DNS record deleted', description: `${deleting.type} ${deleting.name}` });
      setDeleting(null);
    } catch (error) {
      toast({ title: 'Could not delete DNS record', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    }
  };

  const checkRecord = async (record: CloudflareDnsRecord) => {
    try {
      const result = await verifyRecord.mutateAsync({ domainId, recordId: record.id });
      setVerification(prev => ({ ...prev, [record.id]: result }));
      toast({ title: result.publiclyVisible ? 'Public DNS answer found' : 'Cloudflare record verified', description: result.publiclyVisible ? 'The record is visible in public DNS.' : 'Configured in Cloudflare, but not yet visible in public DNS.' });
    } catch (error) {
      toast({ title: 'DNS verification failed', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    }
  };

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast({ title: 'Copied to clipboard' }); }
    catch { toast({ title: 'Clipboard unavailable', description: 'Select and copy the value manually.', variant: 'destructive' }); }
  };

  return <div className="space-y-6">
    <Link href="/domains" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="back-to-domains">
      <ArrowLeft className="h-4 w-4" />All domains
    </Link>
    <PageHeader
      title={domain?.hostname ?? (domains.isLoading ? 'Loading domain…' : 'Domain DNS')}
      description="Manage authoritative records in the connected Cloudflare zone. Public DNS visibility is checked separately."
      actions={<Button onClick={openCreate} disabled={!connection.data?.connected || !matchedZone} data-testid="add-dns-record"><Plus className="mr-2 h-4 w-4" />Add record</Button>}
    />

    {domains.isLoading && <div className="h-24 animate-pulse rounded-xl border border-card-border bg-card" data-testid="domain-loading" />}
    {domains.isError && <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5" data-testid="domain-error">
      <p className="font-semibold">Domain could not be loaded</p><p className="mt-1 text-sm text-muted-foreground">The domain details are temporarily unavailable.</p>
      <Button className="mt-3" variant="outline" onClick={() => domains.refetch()}>Retry</Button>
    </section>}
    {!domains.isLoading && !domains.isError && !domain && <section className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <Globe2 className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-semibold">Domain not found</h2>
      <p className="mt-1 text-sm text-muted-foreground">This domain is not registered to your AfuCloud account.</p>
      <Link href="/domains" className="mt-4 inline-flex text-sm font-medium text-primary">Return to domains</Link>
    </section>}

    {domain && <>
      <section className="grid gap-3 sm:grid-cols-2" aria-label="DNS configuration and propagation status">
        <div className="rounded-xl border border-card-border bg-card p-4" data-testid="cloudflare-zone-status">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Cloud className="h-4 w-4 text-primary" />Cloudflare configuration</div>
          {connection.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Checking connection…</p>
            : !connection.data?.connected ? <div className="mt-3"><Badge good={false}>Not connected</Badge><p className="mt-2 text-xs text-muted-foreground">Connect Cloudflare from the <Link href="/domains" className="text-primary underline">domains page</Link> to manage records.</p></div>
            : zones.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Checking available zones…</p>
            : zones.isError ? <div className="mt-3 flex items-center gap-2 text-sm text-destructive">Zone lookup failed<button className="underline" onClick={() => zones.refetch()}>Retry</button></div>
            : matchedZone ? <div className="mt-3 flex items-center justify-between"><div><Badge good={matchedZone.status === 'active'}>{matchedZone.status}</Badge><p className="mt-2 font-mono text-sm">{matchedZone.name}</p></div><span className="text-xs text-muted-foreground">Authoritative zone</span></div>
            : <div className="mt-3"><Badge good={false}>Zone unavailable</Badge><p className="mt-2 text-xs text-muted-foreground">No accessible Cloudflare zone exactly matches this registered domain. Check the connection or zone access.</p></div>}
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4" data-testid="public-dns-status">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Globe2 className="h-4 w-4 text-primary" />Public DNS propagation</div>
          <p className="mt-3 text-sm font-medium">Cloudflare configuration is not the same as public visibility.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use “Check DNS” on a record to compare the authoritative configuration with answers visible to public resolvers. Propagation may take time.</p>
        </div>
      </section>

      {!connection.isLoading && connection.data?.connected && !recordsQuery.isLoading && !recordsQuery.isError && !matchedZone &&
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="zone-missing-notice">DNS management is unavailable because no accessible Cloudflare zone matches <strong>{domain.hostname}</strong>.</div>}

      <section className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div><h2 className="font-semibold">DNS records</h2><p className="mt-0.5 text-xs text-muted-foreground">{recordsQuery.data?.total ?? 0} records · changes are written to Cloudflare</p>
            {cdnHostnames.length > 0 && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Configure missing DNS-only CNAMEs for {cdnHostnames.length} CDN hostname{cdnHostnames.length === 1 ? '' : 's'} in one action. They point to <code>{cdnHostnames[0].dnsRecord.value}</code>; conflicting records are left untouched, and TLS setup is separate.</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {cdnHostnames.length > 0 && <Button variant="outline" onClick={configureCdnDns} disabled={!connection.data?.connected || !matchedZone || domain?.verificationStatus !== 'verified' || autoConfigureHostnames.isPending} data-testid="configure-cdn-hostnames">
              <Cloud className="mr-2 h-4 w-4" />{autoConfigureHostnames.isPending ? 'Configuring…' : 'Configure CDN hostnames'}
            </Button>}
            <div className="flex min-w-0 gap-2">
              <Input aria-label="Search DNS records" placeholder="Filter name or value" value={filter} onChange={event => setFilter(event.target.value)} className="h-9 min-w-0 flex-1 sm:w-48 sm:flex-none" data-testid="dns-search" />
              <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} aria-label="Filter by record type" className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid="dns-type-filter">
                <option value="all">All types</option>{recordTypes.map(type => <option key={type}>{type}</option>)}
              </select>
              <Button variant="outline" size="icon" aria-label="Refresh DNS records" onClick={() => recordsQuery.refetch()} disabled={recordsQuery.isFetching} data-testid="refresh-dns-records"><RefreshCw className={`h-4 w-4 ${recordsQuery.isFetching ? 'animate-spin' : ''}`} /></Button>
            </div>
          </div>
        </div>
        {!connection.isLoading && !connection.data?.connected && <div className="p-10 text-center" data-testid="dns-disconnected">
          <Cloud className="mx-auto h-8 w-8 text-muted-foreground/50" /><h3 className="mt-3 font-semibold">Connect Cloudflare to view DNS</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">AfuCloud only reads and changes records in zones authorized by your Cloudflare account.</p>
          <Link href="/domains" className="mt-4 inline-flex text-sm font-semibold text-primary">Connect Cloudflare</Link>
        </div>}
        {connection.data?.connected && recordsQuery.isLoading && <div className="space-y-3 p-5" data-testid="dns-records-loading">{[1, 2, 3].map(index => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>}
        {connection.data?.connected && recordsQuery.isError && <div className="p-10 text-center" data-testid="dns-records-error">
          <CircleAlert className="mx-auto h-8 w-8 text-destructive" /><h3 className="mt-3 font-semibold">Records could not be loaded</h3>
          <p className="mt-1 text-sm text-muted-foreground">Cloudflare did not return the DNS records for this domain.</p>
          <Button className="mt-4" variant="outline" onClick={() => recordsQuery.refetch()}>Retry records</Button>
        </div>}
        {connection.data?.connected && !recordsQuery.isLoading && !recordsQuery.isError && recordList.length === 0 && <div className="p-10 text-center" data-testid="dns-records-empty">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div>
          <h3 className="mt-3 font-semibold">No DNS records yet</h3><p className="mt-1 text-sm text-muted-foreground">Add a record to start configuring this Cloudflare zone.</p>
          <Button className="mt-4" onClick={openCreate} disabled={!matchedZone}><Plus className="mr-2 h-4 w-4" />Add first record</Button>
        </div>}
        {connection.data?.connected && !recordsQuery.isLoading && !recordsQuery.isError && recordList.length > 0 && filtered.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground" data-testid="dns-records-no-matches">No records match these filters. <button className="text-primary underline" onClick={() => { setFilter(''); setTypeFilter('all'); }}>Clear filters</button></div>}
        {connection.data?.connected && !recordsQuery.isLoading && !recordsQuery.isError && filtered.length > 0 && <div className="divide-y divide-border" data-testid="dns-record-list">
          {filtered.map(record => {
            const check = verification[record.id];
            return <article key={record.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(130px,0.85fr)_minmax(0,2fr)_auto] sm:items-center sm:px-5" data-testid={`dns-record-${record.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="rounded bg-primary/10 px-2 py-1 font-mono text-[11px] font-bold text-primary">{record.type}</span><p className="truncate font-mono text-sm font-medium" title={record.name}>{record.name}</p></div>
                <p className="mt-1 text-[11px] text-muted-foreground">TTL {record.ttl === 1 ? 'Auto' : `${record.ttl}s`}{record.proxied ? ' · Proxied' : ''}{record.priority != null ? ` · Priority ${record.priority}` : ''}</p>
              </div>
              <div className="min-w-0">
                <div className="flex items-start gap-2"><code className="min-w-0 break-all text-xs leading-relaxed">{record.content}</code><button className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => copy(record.content)} aria-label="Copy DNS content" data-testid={`copy-record-${record.id}`}><Copy className="h-3.5 w-3.5" /></button></div>
                {record.comment && <p className="mt-1 text-xs text-muted-foreground">{record.comment}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge good>In Cloudflare</Badge>
                  {check ? <><Badge good={check.cloudflareVerified}>{check.cloudflareVerified ? 'Configured' : 'Not configured'}</Badge><Badge good={check.publiclyVisible}>{check.publiclyVisible ? 'Publicly visible' : 'Not public yet'}</Badge></>
                    : <span className="text-[11px] text-muted-foreground">Public visibility not checked</span>}
                  {check?.checkedAt && <span className="self-center text-[10px] text-muted-foreground">Checked {new Date(check.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
                {check?.answers?.length ? <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Answers: {check.answers.join(', ')}</p> : null}
              </div>
              <div className="flex flex-wrap gap-1 sm:justify-end">
                <Button variant="outline" size="sm" onClick={() => checkRecord(record)} disabled={verifyRecord.isPending} data-testid={`verify-record-${record.id}`}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Check DNS</Button>
                <Button variant="ghost" size="icon" aria-label={`Edit ${record.name}`} onClick={() => openEdit(record)} data-testid={`edit-record-${record.id}`}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${record.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(record)} data-testid={`delete-record-${record.id}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </article>;
          })}
        </div>}
      </section>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Records shown here are configured in Cloudflare. A record can be configured successfully and still not yet be returned by public DNS resolvers.</p>
    </>}

    <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>{editing ? 'Edit DNS record' : 'Add DNS record'}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={saveRecord}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="record-type">Type</Label><select id="record-type" value={form.type} onChange={event => setForm(prev => ({ ...prev, type: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="record-type">{recordTypes.map(type => <option key={type}>{type}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="record-name">Name</Label><Input id="record-name" required value={form.name} onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} placeholder="www or @ " data-testid="record-name" /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="record-content">Content / target</Label><Textarea id="record-content" value={form.content} onChange={event => setForm(prev => ({ ...prev, content: event.target.value }))} placeholder={form.type === 'TXT' ? 'Verification or policy value' : 'IP address, hostname, or record value'} rows={3} data-testid="record-content" /><p className="text-[11px] text-muted-foreground">Some structured record types use the optional data object below instead of content.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="record-ttl">TTL</Label><select id="record-ttl" value={form.ttl} onChange={event => setForm(prev => ({ ...prev, ttl: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="record-ttl"><option value="1">Automatic</option><option value="60">1 minute</option><option value="300">5 minutes</option><option value="900">15 minutes</option><option value="3600">1 hour</option><option value="86400">1 day</option></select></div>
            <div className="space-y-2"><Label htmlFor="record-priority">Priority <span className="font-normal text-muted-foreground">optional</span></Label><Input id="record-priority" type="number" min="0" value={form.priority} onChange={event => setForm(prev => ({ ...prev, priority: event.target.value }))} placeholder="10" data-testid="record-priority" /></div>
          </div>
          {['A', 'AAAA', 'CNAME'].includes(form.type) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.proxied} onChange={event => setForm(prev => ({ ...prev, proxied: event.target.checked }))} className="h-4 w-4 accent-primary" data-testid="record-proxied" />Proxy traffic through Cloudflare</label>}
          <div className="space-y-2"><Label htmlFor="record-comment">Comment <span className="font-normal text-muted-foreground">optional</span></Label><Input id="record-comment" value={form.comment} onChange={event => setForm(prev => ({ ...prev, comment: event.target.value }))} placeholder="Why this record exists" data-testid="record-comment" /></div>
          <div className="space-y-2"><Label htmlFor="record-data">Structured data <span className="font-normal text-muted-foreground">optional JSON</span></Label><Textarea id="record-data" value={form.data} onChange={event => setForm(prev => ({ ...prev, data: event.target.value }))} placeholder={'{\n  "flags": 0\n}'} rows={3} className="font-mono text-xs" data-testid="record-data" /></div>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)} data-testid="cancel-record">Cancel</Button>
            <Button type="submit" disabled={saving || !matchedZone} data-testid="save-record">{saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}{saving ? 'Saving…' : editing ? 'Save changes' : 'Create record'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
      <AlertDialogContent data-testid="delete-record-confirmation">
        <AlertDialogHeader><AlertDialogTitle>Delete this DNS record?</AlertDialogTitle>
          <AlertDialogDescription>This permanently removes <strong>{deleting?.type} {deleting?.name}</strong> from Cloudflare. This may affect live traffic or email delivery. Public DNS may continue serving cached answers briefly.</AlertDialogDescription></AlertDialogHeader>
        <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Record content</p><code className="mt-1 block break-all text-xs">{deleting?.content}</code></div>
        <AlertDialogFooter><AlertDialogCancel data-testid="cancel-delete-record">Keep record</AlertDialogCancel><AlertDialogAction onClick={event => { event.preventDefault(); void confirmDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteRecord.isPending} data-testid="confirm-delete-record">{deleteRecord.isPending ? 'Deleting…' : 'Delete record'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}