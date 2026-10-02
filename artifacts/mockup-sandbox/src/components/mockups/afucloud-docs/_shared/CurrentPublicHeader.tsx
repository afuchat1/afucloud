import { Button } from '../../afucloud-buttons/_shared/CurrentButton';

export function CurrentPublicHeader() {
  return (
    <header className='sticky top-0 z-40 border-b border-border/50 bg-background/90 backdrop-blur-sm'>
      <div className='mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6'>
        <a href='/' className='flex shrink-0 items-center gap-2.5'>
          <span aria-hidden='true' className='inline-flex h-8 w-8 shrink-0'>
            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128' fill='none' className='h-full w-full'>
              <path d='M32 100C17 100 8 89 8 75C8 62 18 52 31 50C34 31 49 19 66 19C83 19 96 30 100 46C113 49 121 59 121 73C121 89 110 100 94 100H32Z' fill='#07965B' />
              <g stroke='#FFFFFF' strokeWidth='5' strokeLinecap='round'><path d='M45 72L64 54L83 72' /></g>
              <g fill='#FFFFFF'><circle cx='45' cy='75' r='9' /><circle cx='64' cy='51' r='9' /><circle cx='83' cy='75' r='9' /></g>
            </svg>
          </span>
          <span className='text-[15px] font-semibold tracking-tight'>AfuCloud</span>
        </a>
        <nav className='hidden items-center gap-6 text-sm text-muted-foreground md:flex' aria-label='Public navigation'>
          <a href='/#features' className='transition-colors hover:text-foreground'>Features</a>
          <a href='/#pricing' className='transition-colors hover:text-foreground'>Pricing</a>
          <a href='/docs' className='transition-colors hover:text-foreground'>Docs</a>
          <a href='/roadmap' className='transition-colors hover:text-foreground'>Roadmap</a>
        </nav>
        <div className='flex items-center gap-2'>
          <a href='/login'><Button variant='ghost' size='sm'>Sign in</Button></a>
          <a href='/register'><Button size='sm'>Get started</Button></a>
        </div>
      </div>
    </header>
  );
}
