import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'>;

export function PasswordInput({ className, disabled, id, ...props }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const toggleLabel = isVisible ? 'Hide password' : 'Show password';

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type={isVisible ? 'text' : 'password'}
        disabled={disabled}
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        aria-label={toggleLabel}
        aria-pressed={isVisible}
        title={toggleLabel}
        data-testid={id ? `button-toggle-visibility-${id}` : 'button-toggle-visibility-password'}
        disabled={disabled}
        onClick={() => setIsVisible((visible) => !visible)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {isVisible
          ? <EyeOff className="h-4 w-4" aria-hidden="true" />
          : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
