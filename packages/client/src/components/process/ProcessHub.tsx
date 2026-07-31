import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { ZPageHeader } from '../ui/operator/ZPageHeader';
import { ZFilterPills } from '../ui/operator/ZFilterPills';
import { ZInput } from '../primitives/ZInput';
import { ZButton } from '../primitives/ZButton';
import { useProcessStore, type ProcessQueueCard, type QueueStatusFilter } from '../../store/processStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { getProcessConfig } from '../../lib/processConfig';
import { useShiftStore } from '../../store/shiftStore';
import { apiClient } from '../../lib/apiClient';
import { AnnBatchesPanel } from './bodies/AnnBatchesPanel';
import { findPklSiblingCoils, pklGroupWeightMt } from '../../lib/pklSiblingSelect';

const STATUS_FILTERS: { id: QueueStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'HOLD', label: 'Hold' },
  { id: 'COMPLETED', label: 'Completed' },
];

function matchesFilter(card: ProcessQueueCard, filter: QueueStatusFilter): boolean {
  if (filter === 'ALL') return card.status !== 'COMPLETED';
  if (filter === 'IN_PROGRESS') return card.status === 'IN_PROGRESS';
  return card.status === filter;
}

interface ProcessHubProps {
  processCode: string;
}

export function ProcessHub({ processCode }: ProcessHubProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { basePath } = useProcessWorkspaceBase();
  const config = getProcessConfig(processCode);
  const { shiftLogId, producedMt, targetMt } = useShiftStore();
  const {
    queue,
    statusFilter,
    queueRefreshToken,
    hubTab,
    setStatusFilter,
    setHubTab,
    loadQueue,
    setActiveCoil,
    setPklGroup,
    clearPklGroup,
    createManualCoil,
    busy,
    manualModalToken,
    pklGroupCoilNos,
    pklGroupWeightMt: groupWt,
  } = useProcessStore();

  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCoil, setManualCoil] = useState({ coilNo: '', gradeCode: '', customerName: '', widthMm: 0, thicknessMm: 0, weightMt: 0 });
  const [crsMetrics, setCrsMetrics] = useState<{
    totalProdMt: number; forCtlMt: number; holdMt: number; coilShipMt: number;
    rejectionOdMt: number; rejectionIdMt: number; scrapPct: number; settingCount: number;
  } | null>(null);
  const [hrsMetrics, setHrsMetrics] = useState<{
    targetMt: number; totalProdMt: number; scrapMt: number; scrapPct: number;
    coilsDone: number; settingCount: number;
  } | null>(null);
  const [pklMetrics, setPklMetrics] = useState<{
    totalProdMt: number; coilsDone: number; avgLineSpeed: number; repeats: number;
    chartReadings: number; chartDue: number;
  } | null>(null);

  const tab = searchParams.get('tab') ?? hubTab;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadQueue();
      if (processCode === 'CRS' && shiftLogId) {
        try {
          const m = await apiClient.get<{
            totalProdMt: number; forCtlMt: number; holdMt: number; coilShipMt: number;
            rejectionOdMt: number; rejectionIdMt: number; scrapPct: number; settingCount: number;
          }>(`/stations/crs/shift-metrics/${encodeURIComponent(shiftLogId)}`);
          setCrsMetrics(m);
        } catch {
          setCrsMetrics(null);
        }
      }
      if (processCode === 'HRS' && shiftLogId) {
        try {
          const m = await apiClient.get<{
            targetMt: number; totalProdMt: number; scrapMt: number; scrapPct: number;
            coilsDone: number; settingCount: number;
          }>(`/stations/hrs/shift-metrics/${encodeURIComponent(shiftLogId)}`);
          setHrsMetrics(m);
        } catch {
          setHrsMetrics(null);
        }
      }
      if (processCode === 'PKL' && shiftLogId) {
        try {
          const m = await apiClient.get<{
            totalProdMt: number; coilsDone: number; avgLineSpeed: number; repeats: number;
            chartReadings: number; chartDue: number;
          }>(`/stations/pkl/shift-metrics/${encodeURIComponent(shiftLogId)}`);
          setPklMetrics(m);
        } catch {
          setPklMetrics(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [loadQueue, processCode, shiftLogId]);

  useEffect(() => {
    void refresh();
  }, [refresh, processCode, queueRefreshToken]);

  useEffect(() => {
    setHubTab(tab === 'chart' ? 'chart' : tab === 'charges' ? 'charges' : 'coils');
  }, [tab, setHubTab]);

  // ANN operators land on the base board first.
  useEffect(() => {
    if (processCode !== 'ANN') return;
    if (searchParams.get('tab')) return;
    setSearchParams({ tab: 'charges' }, { replace: true });
  }, [processCode, searchParams, setSearchParams]);

  useEffect(() => {
    if (processCode !== 'PKL') return;
    if (manualModalToken > 0) setManualOpen(true);
  }, [manualModalToken, processCode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue.filter((c) => matchesFilter(c, statusFilter)).filter((c) =>
      !q || c.coilNo.toLowerCase().includes(q) || c.customerName.toLowerCase().includes(q),
    );
  }, [queue, statusFilter, search]);

  const selectedSet = useMemo(() => new Set(pklGroupCoilNos), [pklGroupCoilNos]);

  function openCapture(card: ProcessQueueCard) {
    if (processCode === 'PKL') {
      const siblings = findPklSiblingCoils(card, queue);
      const nos = siblings.map((s) => s.coilNo);
      setPklGroup(nos, pklGroupWeightMt(siblings));
      setActiveCoil(card.coilNo, {
        ...(card.prefill ?? {}),
        orderLines: card.orderLines,
        widthMm: card.widthMm,
        thicknessMm: card.thicknessMm,
        weightMt: card.weightMt,
        gradeCode: card.gradeCode,
        motherCoilNo: card.motherCoilNo,
        slitId: card.slitId,
      });
      navigate(`${basePath}/capture/${encodeURIComponent(card.coilNo)}`);
      return;
    }
    clearPklGroup();
    setActiveCoil(card.coilNo, {
      ...(card.prefill ?? {}),
      orderLines: card.orderLines,
      widthMm: card.widthMm,
      thicknessMm: card.thicknessMm,
      weightMt: card.weightMt,
      gradeCode: card.gradeCode,
    });
    navigate(`${basePath}/capture/${encodeURIComponent(card.coilNo)}`);
  }

  async function submitManual() {
    await createManualCoil(manualCoil);
    setManualOpen(false);
  }

  const tabs = [
    { id: 'coils', label: processCode === 'ANN' ? 'Batches' : 'Coils' },
    ...(config.extraTabs ?? []),
    ...(config.archetype === 'B' ? [{ id: 'charges', label: 'Bases' }] : []),
  ];

  const subtitle = processCode === 'CRS' && crsMetrics
    ? `Prod ${crsMetrics.totalProdMt.toFixed(2)} · CTL ${crsMetrics.forCtlMt.toFixed(2)} · Hold ${crsMetrics.holdMt.toFixed(2)} · Ship ${crsMetrics.coilShipMt.toFixed(2)} · Rej ${ (crsMetrics.rejectionOdMt + crsMetrics.rejectionIdMt).toFixed(2)} · Scrap ${crsMetrics.scrapPct}% · Settings ${crsMetrics.settingCount}`
    : processCode === 'HRS' && hrsMetrics
      ? `Target ${hrsMetrics.targetMt.toFixed(2)} · Prod ${hrsMetrics.totalProdMt.toFixed(2)} · Scrap ${hrsMetrics.scrapMt.toFixed(2)} (${hrsMetrics.scrapPct}%) · Coils ${hrsMetrics.coilsDone} · Settings ${hrsMetrics.settingCount}`
      : processCode === 'PKL' && pklMetrics
        ? `Prod ${pklMetrics.totalProdMt.toFixed(2)} · Coils ${pklMetrics.coilsDone} · Avg speed ${pklMetrics.avgLineSpeed} · Repeats ${pklMetrics.repeats} · Chart ${pklMetrics.chartReadings}/${pklMetrics.chartDue}`
        : `Shift · ${producedMt ?? 0} / ${targetMt ?? '—'} MT`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ZPageHeader
        title={config.label}
        subtitle={subtitle}
      />

      {tabs.length > 1 && (
        <div className="px-4 flex gap-2 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={[
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground',
              ].join(' ')}
              onClick={() => {
                if (t.id === 'chart') navigate(`${basePath}/chart`);
                else setSearchParams({ tab: t.id });
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {config.archetype === 'B' && tab === 'charges' ? (
        <div className="flex-1 overflow-auto">
          <config.bodyComponent coilNo="" prefill={{}} shiftLogId={shiftLogId ?? ''} machineCode={processCode} />
        </div>
      ) : processCode === 'ANN' && tab === 'coils' ? (
        <AnnBatchesPanel />
      ) : (
        <>
          <div className="px-4 py-3 flex flex-wrap gap-3 items-center border-b border-border">
            <ZFilterPills
              options={STATUS_FILTERS}
              activeId={statusFilter}
              onChange={(id) => setStatusFilter(id as QueueStatusFilter)}
            />
            <div className="flex-1 min-w-[12rem] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <ZInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search coil…" className="pl-9" />
            </div>
            {processCode === 'PKL' && pklGroupCoilNos.length > 0 && (
              <p className="text-sm font-medium tabular-nums">
                Selected {pklGroupCoilNos.length} · Σ {groupWt.toFixed(2)} MT
              </p>
            )}
            <ZButton type="button" variant="secondary" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </ZButton>
            <ZButton type="button" onClick={() => setManualOpen(true)}>Manual Add</ZButton>
          </div>

          <div className="flex-1 overflow-auto p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((card) => {
              const selected = processCode === 'PKL' && selectedSet.has(card.coilNo);
              return (
              <button
                key={card.coilNo}
                type="button"
                onClick={() => openCapture(card)}
                className={[
                  'text-left border rounded-xl p-4 hover:border-primary/40 hover:bg-secondary/20 transition-colors',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : '',
                ].join(' ')}
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="font-bold text-lg">{card.displayCoilNo ?? card.coilNo}</span>
                  <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-secondary">{card.status}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{card.customerName}</p>
                <p className="text-xs mt-2">
                  {card.gradeCode} · {card.widthMm} mm · {card.thicknessMm} mm · {card.weightMt} MT
                  {card.lineCount != null && card.lineCount > 1 ? ` · ${card.lineCount} lines` : ''}
                  {card.combination ? ` · ${card.combination}` : ''}
                </p>
                {processCode === 'PKL' && (card.motherCoilNo || card.slitId) && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Mother {card.motherCoilNo ?? '—'} · Slit {card.slitId ?? '—'}
                  </p>
                )}
              </button>
              );
            })}
            {!loading && filtered.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-12">No coils in queue</p>
            )}
          </div>
        </>
      )}

      {manualOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl p-6 w-full max-w-md space-y-3">
            <h3 className="font-bold">Manual Coil</h3>
            {(['coilNo', 'gradeCode', 'customerName'] as const).map((k) => (
              <ZInput key={k} label={k} value={manualCoil[k]} onChange={(e) => setManualCoil({ ...manualCoil, [k]: e.target.value })} />
            ))}
            {(['widthMm', 'thicknessMm', 'weightMt'] as const).map((k) => (
              <ZInput key={k} label={k} type="number" value={manualCoil[k]} onChange={(e) => setManualCoil({ ...manualCoil, [k]: Number(e.target.value) })} />
            ))}
            <div className="flex gap-2 justify-end">
              <ZButton type="button" variant="secondary" onClick={() => setManualOpen(false)}>Cancel</ZButton>
              <ZButton type="button" onClick={() => void submitManual()} disabled={busy}>Add</ZButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
