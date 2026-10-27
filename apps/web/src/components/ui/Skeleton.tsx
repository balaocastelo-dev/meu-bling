import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />;
}

/** Skeleton de página inteira (cards + tabela) */
export function PaginaSkeleton() {
  return (
    <div className="space-y-4 anim-in">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-4 anim-in">
      <Skeleton className="h-40" />
      <Skeleton className="h-56" />
      <Skeleton className="h-32" />
    </div>
  );
}
