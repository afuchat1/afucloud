import { useGetAnalyticsOverview } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { formatBytes, formatNumber } from '@/lib/utils';
import { Database, HardDrive, Zap, Download, Eye, FolderOpen, TrendingUp } from 'lucide-react';

export default function AnalyticsPage() {
  const { data: overview, isLoading } = useGetAnalyticsOverview();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="Platform-wide usage metrics and performance insights"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          [...Array(8)].map((_, i) => (
            <div key={i} className="h-28 rounded-lg border border-card-border bg-card animate-pulse" />
          ))
        ) : (
          <>
            <StatCard label="Total Images" value={formatNumber(overview?.totalImages || 0)} icon={Database} />
            <StatCard label="Storage Used" value={formatBytes(overview?.totalStorageUsed || 0)} icon={HardDrive} />
            <StatCard label="API Requests" value={formatNumber(overview?.totalApiRequests || 0)} icon={Zap} />
            <StatCard label="Projects" value={overview?.totalProjects || 0} icon={FolderOpen} />
          </>
        )}
      </div>

      <div className="rounded-lg border border-card-border bg-card p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-3">
            <TrendingUp className="h-6 w-6 text-primary" strokeWidth={2} />
          </div>
          <h3 className="text-base font-semibold text-foreground">Detailed analytics coming soon</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Charts, bandwidth tracking, transformation usage, and per-project breakdowns will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
