/** Shared section chrome for ANN shift review cards. */
export function AnnReviewCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-white p-4 shadow-sm ${className}`}>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
