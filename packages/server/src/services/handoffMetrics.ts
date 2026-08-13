/** In-process hand-off observability counters (Phase 0). */
const counters = new Map<string, number>();

function key(name: string, labels: Record<string, string>): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

export function incrementHandoffMetric(name: string, labels: Record<string, string> = {}, delta = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + delta);
}

export function recordQueueRenderSkip(line: string, reason: string): void {
  incrementHandoffMetric('queue_render_skip', { line, reason });
}

export function recordAdvanceNoopNullBatch(processCode: string): void {
  incrementHandoffMetric('advance_noop_null_batch', { process: processCode });
}

export function recordAnnFanoutAdvanceFailed(): void {
  incrementHandoffMetric('ann_fanout_advance_failed');
}

export function recordHandoffSelfHeal(action: string): void {
  incrementHandoffMetric('handoff_self_heal', { action });
}

export function getHandoffMetricsSnapshot(): Record<string, number> {
  return Object.fromEntries(counters.entries());
}

export function resetHandoffMetricsForTests(): void {
  counters.clear();
}
