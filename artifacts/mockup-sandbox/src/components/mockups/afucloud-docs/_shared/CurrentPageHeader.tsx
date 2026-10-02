import type React from 'react';
import { cn } from '@/lib/utils';

export function CurrentPageHeader({ title, description, className }: { title: string; description?: string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4', className)}>
      <div className='min-w-0 space-y-1'>
        <h1 className='break-words text-2xl font-semibold tracking-tight text-foreground'>{title}</h1>
        {description && <p className='break-words text-sm text-muted-foreground'>{description}</p>}
      </div>
    </div>
  );
}
