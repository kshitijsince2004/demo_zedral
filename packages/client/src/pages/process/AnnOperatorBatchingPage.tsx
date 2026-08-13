import { AnnBatchingWorkspace } from '../../components/process/AnnBatchingWorkspace';

/** Operator Ann Batching — ProcessLayout/OperatorShell already wraps Outlet. */
export function AnnOperatorBatchingPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">Ann Batching</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Stack orders bottom→top, assign batch + base, create charge</p>
      </header>
      <AnnBatchingWorkspace />
    </div>
  );
}
