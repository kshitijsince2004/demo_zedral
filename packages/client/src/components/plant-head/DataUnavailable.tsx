interface DataUnavailableProps {
  message: string;
  className?: string;
}

/** Explicit empty state when verified backend data is not available. */
export function DataUnavailable({ message, className = '' }: DataUnavailableProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground min-h-[120px] ${className}`}
      role="status"
    >
      <p>{message}</p>
    </div>
  );
}
