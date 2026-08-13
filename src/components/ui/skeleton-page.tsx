import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
    />
  );
}

/**
 * PageSkeleton — a content-aware skeleton screen for page loading states.
 * Renders a header, subtitle, and card grid placeholder.
 */
export function PageSkeleton() {
  return (
    // data-testid: every page is lazy-loaded behind one app-level <Suspense>, so
    // a navigation resolves long before the chunk does. Tests wait for this to
    // disappear rather than racing the loader.
    <div data-testid="page-skeleton" className="min-h-screen p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Stats row */}
      <div className="flex gap-4">
        <Skeleton className="h-20 w-32 rounded-xl" />
        <Skeleton className="h-20 w-32 rounded-xl" />
        <Skeleton className="h-20 w-32 rounded-xl" />
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * CardSkeleton — a single card loading skeleton for flashcard/review screens.
 */
export function CardSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="flex gap-2 justify-center">
          <Skeleton className="h-10 w-20 rounded-lg" />
          <Skeleton className="h-10 w-20 rounded-lg" />
          <Skeleton className="h-10 w-20 rounded-lg" />
          <Skeleton className="h-10 w-20 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * FeedSkeleton — skeleton for discover/feed-style pages.
 */
export function FeedSkeleton() {
  return (
    <div className="min-h-screen p-4 md:p-8 space-y-4">
      <Skeleton className="h-8 w-40" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3 items-start">
          <Skeleton className="h-24 w-24 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export { Skeleton };
