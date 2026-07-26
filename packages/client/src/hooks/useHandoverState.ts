import useSWR from 'swr';
import {
  machineHandoverService,
  type HandoverPreview,
  type PendingHandover,
} from '../services/machineHandoverService';

/** Shared SWR keys — HandoverAcceptGate + outgoing console + watchers dedupe on these. */
export const handoverKeys = {
  pending: (machineCode: string) => ['handover', 'pending', machineCode] as const,
  preview: (machineCode: string) => ['handover', 'preview', machineCode] as const,
  draft: (machineCode: string) => ['handover', 'draft', machineCode] as const,
};

const DEDUPE_MS = 8_000;

export function useHandoverPending(machineCode: string | null | undefined, enabled = true) {
  const key = machineCode && enabled ? handoverKeys.pending(machineCode) : null;
  return useSWR(
    key,
    async () => {
      const { pending } = await machineHandoverService.getPending(machineCode!);
      return pending;
    },
    {
      dedupingInterval: DEDUPE_MS,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
}

export function useHandoverPreview(machineCode: string | null | undefined, enabled = true) {
  const key = machineCode && enabled ? handoverKeys.preview(machineCode) : null;
  return useSWR<HandoverPreview>(
    key,
    () => machineHandoverService.getPreview(machineCode!),
    {
      dedupingInterval: DEDUPE_MS,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
}

export function useHandoverDraft(machineCode: string | null | undefined, enabled = true) {
  const key = machineCode && enabled ? handoverKeys.draft(machineCode) : null;
  return useSWR(
    key,
    async () => {
      const { draft } = await machineHandoverService.getDraft(machineCode!);
      return draft as PendingHandover | null;
    },
    {
      dedupingInterval: DEDUPE_MS,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
}
