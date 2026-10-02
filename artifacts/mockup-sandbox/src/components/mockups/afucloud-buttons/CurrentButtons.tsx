import './_group.css';
import { Button } from './_shared/CurrentButton';
import { ArrowRight, Check, CircleHelp, Plus } from 'lucide-react';

export function CurrentButtons() {
  return <main className='min-h-screen bg-background p-8 text-foreground'><div className='mx-auto max-w-lg space-y-6'><div><p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>AfuCloud / UI</p><h1 className='mt-2 text-2xl font-semibold'>Current button styles</h1><p className='mt-1 text-sm text-muted-foreground'>Shared button variants before the glass treatment.</p></div><div className='flex flex-wrap gap-3'><Button>Get started</Button><Button variant='secondary'>Secondary</Button><Button variant='outline'>Outline</Button><Button variant='ghost'>Ghost</Button><Button variant='destructive'>Delete</Button><Button variant='link'>Text link</Button><Button size='icon' aria-label='Help'><CircleHelp /></Button></div><div className='flex flex-wrap gap-3'><Button size='sm'><Plus />Small action</Button><Button size='lg'>Large action<ArrowRight /></Button><Button disabled><Check />Disabled</Button></div></div></main>;
}
