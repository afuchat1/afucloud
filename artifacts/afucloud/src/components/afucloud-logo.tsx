import { Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';

type AfuCloudLogoProps = {
  className: string;
  iconClassName: string;
};

export function AfuCloudLogo({ className, iconClassName }: AfuCloudLogoProps) {
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center', className)}>
      <Cloud className={iconClassName} strokeWidth={2.5} />
    </span>
  );
}