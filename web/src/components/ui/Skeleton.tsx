import { cn } from "@/lib/client/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} aria-hidden="true" />;
}

export function MailListSkeleton() {
  return (
    <div className="divide-y divide-border/70" aria-label="Loading messages" role="status">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-4 py-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2.5">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReadingSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6" role="status" aria-label="Loading conversation">
      <Skeleton className="h-6 w-2/3" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="space-y-3 pt-4">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-5/6" />
      </div>
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-2 p-3" role="status" aria-label="Loading folders">
      <Skeleton className="mb-5 h-10 w-full rounded-xl" />
      {Array.from({ length: 9 }).map((_, index) => (
        <Skeleton key={index} className="h-8 w-[86%]" />
      ))}
    </div>
  );
}
