import { PageHeader } from '@/components/page-header';
import { BookOpen, Code, Zap, Lock, Upload, Image, ArrowRight } from 'lucide-react';

const sections = [
  {
    icon: Zap,
    title: 'Quick Start',
    description: 'Get your first image uploaded in under 5 minutes.',
    badge: 'Start here',
  },
  {
    icon: Lock,
    title: 'Authentication',
    description: 'JWT access tokens, refresh tokens, and personal access tokens.',
  },
  {
    icon: Upload,
    title: 'Uploading Images',
    description: 'Single upload, bulk upload, chunked uploads, and resumable transfers.',
  },
  {
    icon: Image,
    title: 'Image Transformations',
    description: 'Resize, crop, convert formats, and apply effects via URL parameters.',
  },
  {
    icon: Code,
    title: 'API Reference',
    description: 'Complete OpenAPI specification with all endpoints, request/response schemas.',
  },
  {
    icon: Lock,
    title: 'Webhooks',
    description: 'Subscribe to events and receive signed payloads for real-time integrations.',
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Developer Documentation"
        description="Everything you need to integrate AfuCloud into your applications"
      />

      <div className="rounded-lg border border-card-border bg-card p-6 flex items-start gap-4">
        <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
          <BookOpen className="h-5 w-5 text-primary" strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Interactive API Explorer</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Full OpenAPI documentation with live request testing will be available at{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">api.afuchat.com/v1/docs</code>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((section) => (
          <button
            key={section.title}
            className="group text-left rounded-lg border border-card-border bg-card p-5 hover:border-primary/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                  <section.icon className="h-4 w-4 text-primary" strokeWidth={2} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                    {section.badge && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {section.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 mt-0.5" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
