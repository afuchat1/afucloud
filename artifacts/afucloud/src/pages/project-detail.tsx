import { useState, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetProject,
  useGetProjectStats,
  useListImages,
  useGetUploadUrl,
  useConfirmUpload,
  useUpdateImage,
  useDeleteImage,
  useToggleImageFavorite,
  getListImagesQueryKey,
  getGetProjectStatsQueryKey,
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { formatBytes, formatDate } from '@/lib/utils';
import {
  Upload,
  Image as ImageIcon,
  HardDrive,
  Star,
  Search,
  Settings,
  Trash2,
  Download,
  BarChart3,
  Key,
  Webhook,
  ArrowLeft,
} from 'lucide-react';
import type { Image } from '@workspace/api-client-react';

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id!;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [search, setSearch] = useState('');
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: project, isLoading: projectLoading } = useGetProject(projectId);
  const { data: stats, isLoading: statsLoading } = useGetProjectStats(projectId);
  const { data: imagesData, isLoading: imagesLoading } = useListImages(projectId, {
    search: search || undefined,
  });
  
  const getUploadUrlMutation = useGetUploadUrl();
  const confirmUploadMutation = useConfirmUpload();
  const updateImageMutation = useUpdateImage();
  const deleteImageMutation = useDeleteImage();
  const toggleFavoriteMutation = useToggleImageFavorite();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const file = files[0];

    try {
      // Get upload URL
      const uploadData = await getUploadUrlMutation.mutateAsync({
        data: {
          projectId,
          data: {
            filename: file.name,
            contentType: file.type,
            name: file.name,
          },
        },
      });

      // Upload to S3
      await fetch(uploadData.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      // Confirm upload
      await confirmUploadMutation.mutateAsync({
        data: {
          projectId,
          data: {
            imageId: uploadData.imageId,
            key: uploadData.key,
            size: file.size,
          },
        },
      });

      queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey(projectId) });

      toast({
        title: 'Upload complete',
        description: `${file.name} has been uploaded successfully`,
      });
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to upload file',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleToggleFavorite = (imageId: string) => {
    toggleFavoriteMutation.mutate(
      { projectId, imageId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) });
        },
      }
    );
  };

  const handleDelete = (imageId: string) => {
    if (!confirm('Are you sure you want to delete this image?')) return;
    
    deleteImageMutation.mutate(
      { projectId, imageId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListImagesQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey(projectId) });
          setSelectedImage(null);
          toast({
            title: 'Image deleted',
            description: 'Image has been moved to trash',
          });
        },
      }
    );
  };

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const images = imagesData?.images || [];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link href="/projects">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2" data-testid="button-back">
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
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-analytics">
                <BarChart3 className="h-4 w-4" />
                Analytics
              </Button>
            </Link>
            <Link href={`/projects/${projectId}/api-keys`}>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-api-keys">
                <Key className="h-4 w-4" />
                API Keys
              </Button>
            </Link>
            <Link href={`/projects/${projectId}/webhooks`}>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-webhooks">
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
          <>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 rounded-lg border border-card-border bg-card animate-pulse" />
            ))}
          </>
        ) : (
          <>
            <StatCard label="Total Images" value={stats?.totalImages || 0} icon={ImageIcon} />
            <StatCard label="Storage Used" value={formatBytes(stats?.storageUsed || 0)} icon={HardDrive} />
            <StatCard label="Favorites" value={stats?.favoriteImages || 0} icon={Star} />
            <StatCard label="API Requests" value={stats?.apiRequests || 0} />
          </>
        )}
      </div>

      {/* Upload & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search images..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="gap-2"
          data-testid="button-upload"
        >
          <Upload className="h-4 w-4" />
          {isUploading ? 'Uploading...' : 'Upload Image'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Images Grid */}
      {imagesLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-square rounded-lg border border-card-border bg-card animate-pulse" />
          ))}
        </div>
      ) : images.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((image, index) => (
            <button
              key={image.id}
              onClick={() => setSelectedImage(image)}
              className="group relative aspect-square rounded-lg border border-card-border bg-card overflow-hidden hover:border-border transition-all stagger-item"
              style={{ animationDelay: `${index * 30}ms` }}
              data-testid={`image-${image.id}`}
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
        <EmptyState
          icon={ImageIcon}
          title="No images yet"
          description="Upload your first image to get started"
          action={{
            label: 'Upload Image',
            onClick: () => fileInputRef.current?.click(),
          }}
        />
      )}

      {/* Image Detail Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-3xl">
          {selectedImage && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedImage.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg border border-border overflow-hidden">
                  <img
                    src={selectedImage.publicUrl || selectedImage.url}
                    alt={selectedImage.name}
                    className="w-full"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Format</p>
                    <p className="font-medium mt-1">{selectedImage.format.toUpperCase()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Size</p>
                    <p className="font-medium mt-1">{formatBytes(selectedImage.size)}</p>
                  </div>
                  {selectedImage.width && selectedImage.height && (
                    <div>
                      <p className="text-muted-foreground">Dimensions</p>
                      <p className="font-medium mt-1">{selectedImage.width} × {selectedImage.height}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">Uploaded</p>
                    <p className="font-medium mt-1">{formatDate(selectedImage.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleFavorite(selectedImage.id)}
                    className="gap-2"
                    data-testid="button-favorite"
                  >
                    <Star className={selectedImage.favorite ? 'fill-yellow-400 text-yellow-400' : ''} />
                    {selectedImage.favorite ? 'Unfavorite' : 'Favorite'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="gap-2"
                  >
                    <a href={selectedImage.url} download target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(selectedImage.id)}
                    className="gap-2 ml-auto"
                    data-testid="button-delete"
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
