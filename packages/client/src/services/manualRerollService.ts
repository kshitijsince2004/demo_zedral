import useSWR from 'swr';
import { apiClient } from '../lib/apiClient';
import { currentPlantDate } from '../lib/dateFormat';

export interface ManualRerollOrderHit {
  kind?: 'pending';
  orderId: string;
  batchNumber: string;
  coilNo: string;
  status: string;
  customer: string;
  grade: string | null;
  machineCode: string;
  slitId?: string | null;
  rollFinish?: string | null;
  subProcess?: string | null;
  weightMt?: number | null;
  thkMm?: number | null;
  widthMm?: number | null;
}

export interface ManualRerollStoppage {
  stoppageId: string;
  sessionId: string;
  machineCode: string;
  categoryCode: string;
  stoppageCode: string | null;
  remarks: string | null;
  startTime: string;
  endTime: string | null;
  durationMin: number | null;
}

export interface ManualRerollPass {
  passNo: number;
  thicknessMm: number;
}

export interface ManualRerollSession {
  sessionId: string;
  orderId: string | null;
  batchNumber: string | null;
  batchNumbers?: string[];
  machineCode: string;
  machineType: string;
  operatorId: number;
  shiftCode: string | null;
  rerollQuantity: number | null;
  status: string;
  remarks: string | null;
  startTime: string;
  endTime: string | null;
  durationMin: number | null;
  actualWeightMt?: number | null;
  actualWeightSource?: string | null;
  actualWeightPhotoHash?: string | null;
  ocrConfidence?: number | null;
  ocrRawText?: string | null;
  inputThkMm?: number | null;
  targetThkMm?: number | null;
  destination?: string | null;
  destinationOverride?: boolean;
  etr?: number | null;
  dtr?: number | null;
  passes?: ManualRerollPass[];
  activeStoppage?: ManualRerollStoppage | null;
  stoppages?: ManualRerollStoppage[];
}

export interface ManualRerollOverlayEntry {
  batchNumber: string;
  wasRerolled: boolean;
  lastRerolledThicknessMm: number | null;
  lastRerolledAt: string | null;
  sessionCount: number;
}

export interface ManualRerollSessionCard {
  kind: 'session';
  sessionId: string;
  orderId: string | null;
  batchNumber: string | null;
  batchNumbers: string[];
  status: string;
  machineCode: string;
  weightMt: number | null;
  actualWeightMt?: number | null;
  passes?: ManualRerollPass[];
  remarks: string | null;
  startTime: string;
  endTime: string | null;
  durationMin: number | null;
  activeStoppage: ManualRerollStoppage | null;
  stoppages: ManualRerollStoppage[];
  coilNo?: string;
  customer?: string;
  grade?: string | null;
  slitId?: string | null;
  rollFinish?: string | null;
  thkMm?: number | null;
  widthMm?: number | null;
}

export interface ManualRerollQueue {
  pending: ManualRerollOrderHit[];
  sessions: ManualRerollSessionCard[];
  active: ManualRerollSession | null;
  date: string;
}

export interface ManualRerollSummary {
  machineCode: string;
  from: string;
  to: string;
  shiftCode?: string;
  totalRerollMt: number;
  sessionCount: number;
}

export function useManualRerollQueue(machine: string | null, enabled: boolean, q = '') {
  const today = currentPlantDate();
  const params = new URLSearchParams({ machine: machine ?? '', date: today });
  if (q.trim()) params.set('q', q.trim());
  const key = machine && enabled ? `/manual-reroll/queue?${params}` : null;
  return useSWR<ManualRerollQueue>(key, (url: string) => apiClient.get(url), {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });
}

export function useManualRerollSessions(machine: string | null, enabled: boolean) {
  const key = machine && enabled ? `/manual-reroll/sessions?machine=${encodeURIComponent(machine)}` : null;
  return useSWR<{ sessions: ManualRerollSession[]; active: ManualRerollSession | null }>(
    key,
    (url: string) => apiClient.get(url),
    { refreshInterval: 10_000, revalidateOnFocus: true },
  );
}

export async function listManualRerollSessions(
  machine: string,
): Promise<{ sessions: ManualRerollSession[]; active: ManualRerollSession | null }> {
  return apiClient.get(`/manual-reroll/sessions?machine=${encodeURIComponent(machine)}`);
}

export function useManualRerollSummary(machine: string | null, enabled: boolean) {
  const today = currentPlantDate();
  const key = machine && enabled
    ? `/manual-reroll/summary?machine=${encodeURIComponent(machine)}&from=${today}&to=${today}`
    : null;
  return useSWR<ManualRerollSummary>(key, (url: string) => apiClient.get(url), {
    refreshInterval: 15_000,
  });
}

export async function searchManualRerollOrders(machine: string, q = ''): Promise<ManualRerollOrderHit[]> {
  const params = new URLSearchParams({ machine });
  if (q.trim()) params.set('q', q.trim());
  const res = await apiClient.get<{ orders: ManualRerollOrderHit[] }>(`/manual-reroll/orders?${params}`);
  return res.orders ?? [];
}

export async function prepareManualReroll(input: {
  machine: string;
  batchNumber: string;
  batchNumbers?: string[];
  orderId?: string;
  rerollQuantity?: number;
  remarks?: string;
}): Promise<ManualRerollSession> {
  return apiClient.post('/manual-reroll/sessions', input);
}

/** @deprecated Use prepareManualReroll then startPreparedManualReroll. */
export async function startManualReroll(input: {
  machine: string;
  batchNumber: string;
  batchNumbers?: string[];
  orderId?: string;
  rerollQuantity?: number;
  remarks?: string;
}): Promise<ManualRerollSession> {
  return prepareManualReroll(input);
}

export async function startPreparedManualReroll(
  sessionId: string,
  machine: string,
): Promise<ManualRerollSession> {
  return apiClient.post(`/manual-reroll/sessions/${encodeURIComponent(sessionId)}/start`, { machine });
}

export async function saveManualRerollCapture(
  sessionId: string,
  machine: string,
  payload: {
    actualWeightMt?: number | null;
    actualWeightSource?: string | null;
    actualWeightPhotoHash?: string | null;
    ocrConfidence?: number | null;
    ocrRawText?: string | null;
    destination?: string | null;
    destinationOverride?: boolean | null;
    etr?: number | null;
    dtr?: number | null;
    inputThkMm?: number | null;
    targetThkMm?: number | null;
    passes?: ManualRerollPass[];
  },
): Promise<ManualRerollSession> {
  return apiClient.patch(`/manual-reroll/sessions/${encodeURIComponent(sessionId)}/capture`, {
    machine,
    ...payload,
  });
}

export async function fetchManualRerollOverlay(
  machine: string,
  batchNumbers: string[],
): Promise<ManualRerollOverlayEntry[]> {
  const unique = [...new Set(batchNumbers.map((b) => b.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const params = new URLSearchParams({
    machine,
    batchNumbers: unique.join(','),
  });
  const res = await apiClient.get<{ overlay: ManualRerollOverlayEntry[] }>(
    `/manual-reroll/overlay?${params}`,
  );
  return res.overlay ?? [];
}

export function useManualRerollOverlay(machine: string | null, batchNumbers: string[], enabled: boolean) {
  const key = machine && enabled && batchNumbers.length > 0
    ? `/manual-reroll/overlay?machine=${encodeURIComponent(machine)}&batchNumbers=${encodeURIComponent(
      [...new Set(batchNumbers)].sort().join(','),
    )}`
    : null;
  return useSWR<{ overlay: ManualRerollOverlayEntry[] }>(key, (url: string) => apiClient.get(url), {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
}

export async function fetchManualRerollSession(
  sessionId: string,
  machine: string,
): Promise<ManualRerollSession> {
  return apiClient.get(
    `/manual-reroll/sessions/${encodeURIComponent(sessionId)}?machine=${encodeURIComponent(machine)}`,
  );
}

export async function endManualReroll(
  sessionId: string,
  machine: string,
  remarks?: string,
): Promise<ManualRerollSession> {
  return apiClient.post(`/manual-reroll/sessions/${encodeURIComponent(sessionId)}/end`, { machine, remarks });
}

export async function cancelManualReroll(
  sessionId: string,
  machine: string,
  remarks?: string,
): Promise<ManualRerollSession> {
  return apiClient.post(`/manual-reroll/sessions/${encodeURIComponent(sessionId)}/cancel`, { machine, remarks });
}

export async function holdManualReroll(
  sessionId: string,
  machine: string,
  remarks: string,
): Promise<ManualRerollSession> {
  return apiClient.post(`/manual-reroll/sessions/${encodeURIComponent(sessionId)}/hold`, { machine, remarks });
}

export async function resumeManualReroll(sessionId: string, machine: string): Promise<ManualRerollSession> {
  return apiClient.post(`/manual-reroll/sessions/${encodeURIComponent(sessionId)}/resume`, { machine });
}

/** Close hold so the batch can be started again from Pending. */
export async function releaseManualRerollToPending(
  sessionId: string,
  machine: string,
): Promise<ManualRerollSession> {
  return apiClient.post(
    `/manual-reroll/sessions/${encodeURIComponent(sessionId)}/release-to-pending`,
    { machine },
  );
}

export async function remarkManualReroll(
  sessionId: string,
  machine: string,
  remarks: string,
): Promise<ManualRerollSession> {
  return apiClient.patch(`/manual-reroll/sessions/${encodeURIComponent(sessionId)}/remarks`, { machine, remarks });
}

export async function startManualRerollStoppage(input: {
  sessionId: string;
  machine: string;
  categoryCode: string;
  stoppageCode?: string;
  remarks?: string;
}): Promise<ManualRerollSession> {
  return apiClient.post(
    `/manual-reroll/sessions/${encodeURIComponent(input.sessionId)}/stoppages/start`,
    {
      machine: input.machine,
      categoryCode: input.categoryCode,
      stoppageCode: input.stoppageCode,
      remarks: input.remarks,
    },
  );
}

export async function updateManualRerollStoppage(input: {
  sessionId: string;
  stoppageId: string;
  machine: string;
  categoryCode: string;
  stoppageCode?: string;
  remarks?: string;
}): Promise<ManualRerollSession> {
  return apiClient.patch(
    `/manual-reroll/sessions/${encodeURIComponent(input.sessionId)}/stoppages/${encodeURIComponent(input.stoppageId)}`,
    {
      machine: input.machine,
      categoryCode: input.categoryCode,
      stoppageCode: input.stoppageCode,
      remarks: input.remarks,
    },
  );
}

export async function endManualRerollStoppage(input: {
  sessionId: string;
  stoppageId: string;
  machine: string;
  categoryCode: string;
  stoppageCode?: string;
  remarks?: string;
}): Promise<ManualRerollSession> {
  return apiClient.post(
    `/manual-reroll/sessions/${encodeURIComponent(input.sessionId)}/stoppages/${encodeURIComponent(input.stoppageId)}/end`,
    {
      machine: input.machine,
      categoryCode: input.categoryCode,
      stoppageCode: input.stoppageCode,
      remarks: input.remarks,
    },
  );
}
