import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useGetProject,
  useGetProjectStats,
  useListImages,
  useToggleImageFavorite,
  getListImagesQueryKey,
  getGetProjectStatsQueryKey,
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { formatBytes, formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  Upload, Image as ImageIcon, HardDrive, Star, Search,
  Trash2, Download, BarChart3, Key, Webhook, ArrowLeft,
  CloudUpload, X, CheckCircle2, AlertCircle, RotateCcw,
  RefreshCw,
} from 'lucide-react';
import type { Image } from '@workspace/api-client-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadItem {
  id: string;
  file: File;
  name: string;
  status: 'uploading' | 'done' | 'error';
  progress: number; // 0–100
  error?: string;
}

type Tab = 'images' | 'trash';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'image/gif', 'image/avif', 'image/svg+xml', 'image/heic',
];

function authHeaders() {
  const token = localStorage.getItem('afucloud_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** XHR-based PUT that fires progress events */
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id!;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<Tab>('images');
  const [search, setSearch] = useState('');
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: project, isLoading: projectLoading } = useGetProject(projectId);
  const { data: stats, isLoading: statsLoading } = useGetProjectStats(projectId);
  const { data: imagesData, isLoading: imagesLoading } = useListImages(projectId, {
    search: search || undefined,
  });

  const { data: trashData, isLoading: trashLoading, refetch: refetchTrash } = useQuery({
    queryKey: ['trash', projectId],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/trash`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to load trash');
      return res.json() as Promise<{ images: Image[]; total: number }>;
    },
    enabled: activeTab === 'trash',
  });

  const toggleFavoriteMutation = useToggleImageFavorite();

  // ── Upload logic ──────────────────────────────────────────────────────────────

  const updateQueueItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploadQueue(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const uploadFile = useCallback(
    async (item: UploadItem) => {
      updateQueueItem(item.id, { status: 'uploading', progress: 0 });
      try {
        // 1. Get pre-signed URL
        const urlRes = await fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/upload-url`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            filename: item.file.name,
            contentType: item.file.type || 'application/octet-stream',
            name: item.file.name,
          }),
        });
        if (!urlRes.ok) throw new Error((await urlRes.json()).error || 'Failed to get upload URL');
        const { uploadUrl, imageId, key } = await urlRes.json();

        // 2. Upload to R2 with progress (maps 0-90%)
        await uploadWithProgress(uploadUrl, item.file, (pct) => {
          updateQueueItem(item.id, { progress: Math.round(pct * 0.9) });
        });

        // 3. Confirm
        const confirmRes = await fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/confirm-upload`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ imageId, key, size: item.file.size }),
        });
        if (!confirmRes.ok) throw new Error('Failed to confirm upload');

        updateQueueItem(item.id, { status: 'done', progress: 100 });
        queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey(projectId) });
      } catch (err) {
        updateQueueItem(item.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [projectId, queryClient, updateQueueItem],
  );

  const addFiles = useCallback(
    (files: File[] | FileList) => {
      const fileArr = Array.from(files).filter(
        f => ALLOWED_TYPES.includes(f.type) || f.type.startsWith('image/'),
      );
      if (fileArr.length === 0) {
        toast({ title: 'Unsupported format', description: 'Please upload image files', variant: 'destructive' });
        return;
      }
      const newItems: UploadItem[] = fileArr.map(file => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        status: 'uploading' as const,
        progress: 0,
      }));
      setUploadQueue(prev => [...prev, ...newItems]);
      newItems.forEach(item => uploadFile(item));
    },
    [uploadFile, toast],
  );

  const retryUpload = useCallback(
    (item: UploadItem) => uploadFile(item),
    [uploadFile],
  );

  const dismissDoneItems = () => {
    setUploadQueue(prev => prev.filter(it => it.status !== 'done'));
  };

  // ── Clipboard paste ───────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(f =>
        f.type.startsWith('image/'),
      );
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [addFiles]);

  // ── Drag handlers ─────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  // ── Image actions ─────────────────────────────────────────────────────────────
  const handleToggleFavorite = (imageId: string) => {
    toggleFavoriteMutation.mutate(
      { projectId, imageId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) }) },
    );
  };

  const handleSoftDelete = async (imageId: string) => {
    if (!confirm('Move this image to the Recycle Bin?')) return;
    const res = await fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/${imageId}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey(projectId) });
      setSelectedImage(null);
      toast({ title: 'Moved to Recycle Bin', description: 'You can restore it from the Trash tab' });
    }
  };

  const handleRestore = async (imageId: string) => {
    const res = await fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/${imageId}/restore`, {
      method: 'POST', headers: authHeaders(),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ['trash', projectId] });
      queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey(projectId) });
      toast({ title: 'Image restored' });
    }
  };

  const handlePermanentDelete = async (imageId: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/${imageId}/permanent`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ['trash', projectId] });
      toast({ title: 'Permanently deleted' });
    }
  };

  const handleEmptyTrash = async () => {
    const count = trashData?.images.length ?? 0;
    if (count === 0) return;
    if (!confirm(`Permanently delete all ${count} images in the Recycle Bin? This cannot be undone.`)) return;
    const res = await fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/trash`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ['trash', projectId] });
      toast({ title: 'Recycle Bin emptied', description: `${data.count} images permanently deleted` });
    }
  };

  const handleRestoreAll = async () => {
    const images = trashData?.images ?? [];
    if (images.length === 0) return;
    await Promise.all(
      images.map(img =>
        fetch(`${BASE_URL}/api/v1/projects/${projectId}/images/${img.id}/restore`, {
          method: 'POST', headers: authHeaders(),
        }),
      ),
    );
    queryClient.invalidateQueries({ queryKey: ['trash', projectId] });
    queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey(projectId) });
    toast({ title: `${images.length} images restored` });
  };

  // ── Guards ────────────────────────────────────────────────────────────────────
  if (projectLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!project) {
    return <div className="text-center py-16"><p className="text-muted-foreground">Project not found</p></div>;
  }

  const images = imagesData?.images ?? [];
  const trashImages = trashData?.images ?? [];
  const pendingUploads = uploadQueue.filter(it => it.status !== 'done').length;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/projects">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Projects
        </Button>
      </Link>

      <PageHeader
        title={project.name}
        description={project.description || undefined}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/projects/${projectId}/analytics`}>
              <Button variant="outline" size="sm" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                Analytics
              </Button>
            </Link>
            <Link href={`/projects/${projectId}/api-keys`}>
              <Button variant="outline" size="sm" className="gap-2">
                <Key className="h-4 w-4" />
                API Keys
              </Button>
            </Link>
            <Link href={`/projects/${projectId}/webhooks`}>
              <Button variant="outline" size="sm" className="gap-2">
                <Webhook className="h-4 w-4" />
                Webhooks
              </Button>
            </Link>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {statsLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-lg border border-card-border bg-card animate-pulse" />
          ))
        ) : (
          <>
            <StatCard label="Total Images" value={stats?.totalImages || 0} icon={ImageIcon} />
            <StatCard label="Storage Used" value={formatBytes(stats?.storageUsed || 0)} icon={HardDrive} />
            <StatCard label="Favorites" value={stats?.favoriteImages || 0} icon={Star} />
            <StatCard label="API Requests" value={stats?.apiRequests || 0} />
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-card-border">
        {(['images', 'trash'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === 'trash' ? <Trash2 className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {tab === 'images' ? 'Images' : 'Recycle Bin'}
            {tab === 'trash' && trashImages.length > 0 && (
              <span className="ml-0.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                {trashImages.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── IMAGES TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'images' && (
        <>
          {/* Search + upload button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search images…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" />
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={e => e.target.files && addFiles(e.target.files)}
              className="hidden"
            />
          </div>

          {/* Upload queue */}
          {uploadQueue.length > 0 && (
            <div className="rounded-lg border border-card-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Uploads
                  {pendingUploads > 0 && (
                    <span className="ml-2 text-muted-foreground font-normal normal-case">
                      {pendingUploads} in progress…
                    </span>
                  )}
                </p>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={dismissDoneItems}>
                  Clear done
                </Button>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {uploadQueue.map(item => (
                  <div key={item.id} className="flex items-center gap-3">
                    {/* Status icon */}
                    <div className="shrink-0 w-5">
                      {item.status === 'done' && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      {item.status === 'error' && (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                      {item.status === 'uploading' && (
                        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    {/* Name + bar */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-xs font-medium truncate text-foreground">{item.name}</p>
                      {item.status === 'uploading' && (
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-200"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      )}
                      {item.status === 'error' && (
                        <p className="text-[10px] text-destructive">{item.error}</p>
                      )}
                    </div>
                    {/* Progress % or retry */}
                    <div className="shrink-0 text-[11px] text-muted-foreground w-12 text-right">
                      {item.status === 'uploading' && `${item.progress}%`}
                      {item.status === 'done' && (
                        <span className="text-green-600">Done</span>
                      )}
                      {item.status === 'error' && (
                        <button
                          onClick={() => retryUpload(item)}
                          className="flex items-center gap-0.5 text-primary hover:underline text-[11px]"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </button>
                      )}
                    </div>
                    {/* Dismiss */}
                    {item.status !== 'uploading' && (
                      <button
                        onClick={() => setUploadQueue(prev => prev.filter(i => i.id !== item.id))}
                        className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drag-and-drop zone + images grid */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative rounded-xl border-2 border-dashed transition-colors min-h-[120px]',
              isDragOver
                ? 'border-primary bg-primary/5'
                : 'border-transparent',
            )}
          >
            {/* Drop overlay */}
            {isDragOver && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl pointer-events-none">
                <CloudUpload className="h-10 w-10 text-primary mb-2" strokeWidth={1.5} />
                <p className="text-sm font-semibold text-primary">Drop images here</p>
              </div>
            )}

            {imagesLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg border border-card-border bg-card animate-pulse" />
                ))}
              </div>
            ) : images.length > 0 ? (
              <div className={cn('grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4', isDragOver && 'opacity-30')}>
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    onClick={() => setSelectedImage(image)}
                    className="group relative aspect-square rounded-lg border border-card-border bg-card overflow-hidden hover:border-border transition-all"
                    style={{ animationDelay: `${index * 20}ms` }}
                  >
                    <img
                      src={image.publicUrl || image.url}
                      alt={image.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 text-left opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-xs font-medium text-white truncate">{image.name}</p>
                      <p className="text-xs text-white/80">{formatBytes(image.size)}</p>
                    </div>
                    {image.favorite && (
                      <div className="absolute top-2 right-2">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              !isDragOver && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                  <div className="h-14 w-14 rounded-xl border-2 border-dashed border-border flex items-center justify-center">
                    <CloudUpload className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Drop images here to upload</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      or{' '}
                      <button
                        className="text-primary underline underline-offset-2"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        browse files
                      </button>
                      {' '}· Paste with Ctrl+V · PNG, JPEG, WebP, GIF, AVIF, SVG
                    </p>
                  </div>
                </div>
              )
            )}
          </div>

          {images.length > 0 && !isDragOver && (
            <p className="text-xs text-muted-foreground text-center">
              Drag images anywhere on this page to upload · or paste with Ctrl+V
            </p>
          )}
        </>
      )}

      {/* ── TRASH TAB ──────────────────────────────────────────────────────────── */}
      {activeTab === 'trash' && (
        <div className="space-y-4">
          {/* Trash actions bar */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {trashLoading
                ? 'Loading…'
                : trashImages.length === 0
                ? 'Recycle Bin is empty'
                : `${trashImages.length} image${trashImages.length !== 1 ? 's' : ''} in trash`}
            </p>
            {trashImages.length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={handleRestoreAll}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore all
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={handleEmptyTrash}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Empty Bin
                </Button>
              </div>
            )}
          </div>

          {/* Info banner */}
          {trashImages.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">
              Images in the Recycle Bin are not counted in your storage. Permanently deleted images cannot be recovered.
            </div>
          )}

          {/* Trash grid */}
          {trashLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="aspect-square rounded-lg border border-card-border bg-card animate-pulse" />
              ))}
            </div>
          ) : trashImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <Trash2 className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Recycle Bin is empty</p>
                <p className="text-xs text-muted-foreground mt-1">Deleted images will appear here</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {trashImages.map(image => (
                <div
                  key={image.id}
                  className="group relative rounded-lg border border-card-border bg-card overflow-hidden"
                >
                  <div className="aspect-square relative">
                    <img
                      src={image.publicUrl || image.url}
                      alt={image.name}
                      className="w-full h-full object-cover opacity-60 grayscale"
                    />
                  </div>
                  <div className="p-2.5 space-y-1.5">
                    <p className="text-xs font-medium text-foreground truncate">{image.name}</p>
                    {image.deletedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        Deleted {formatDate(image.deletedAt)}
                      </p>
                    )}
                    <div className="flex gap-1.5 pt-0.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 text-xs gap-1"
                        onClick={() => handleRestore(image.id)}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handlePermanentDelete(image.id, image.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Image Detail Dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-3xl">
          {selectedImage && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedImage.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
                  <img
                    src={selectedImage.publicUrl || selectedImage.url}
                    alt={selectedImage.name}
                    className="w-full max-h-96 object-contain"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground text-xs">Format</p><p className="font-medium mt-0.5">{selectedImage.format.toUpperCase()}</p></div>
                  <div><p className="text-muted-foreground text-xs">Size</p><p className="font-medium mt-0.5">{formatBytes(selectedImage.size)}</p></div>
                  {selectedImage.width && selectedImage.height && (
                    <div><p className="text-muted-foreground text-xs">Dimensions</p><p className="font-medium mt-0.5">{selectedImage.width} × {selectedImage.height}px</p></div>
                  )}
                  <div><p className="text-muted-foreground text-xs">Uploaded</p><p className="font-medium mt-0.5">{formatDate(selectedImage.createdAt)}</p></div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Public URL</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono truncate text-foreground">
                      {selectedImage.publicUrl || selectedImage.url}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs shrink-0"
                      onClick={() => navigator.clipboard.writeText(selectedImage.publicUrl || selectedImage.url)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleFavorite(selectedImage.id)}
                    className="gap-2"
                  >
                    <Star className={cn('h-4 w-4', selectedImage.favorite && 'fill-yellow-400 text-yellow-400')} />
                    {selectedImage.favorite ? 'Unfavorite' : 'Favorite'}
                  </Button>
                  <Button variant="outline" size="sm" asChild className="gap-2">
                    <a href={selectedImage.url} download target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleSoftDelete(selectedImage.id)}
                    className="gap-2 ml-auto"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
