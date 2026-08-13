import type { LiveOrderRow, MachineStatusCard } from '@m1/shared-validation';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { DataUnavailable } from './DataUnavailable';
import { ZBadge } from '../primitives/ZBadge';
import { OrderIdentityDisplay } from '../orders/OrderIdentityDisplay';
import { MachineStatusBoard } from '../live/MachineStatusBoard';
import { formatOrderStatusLabel } from '../../lib/orderLabels';
import { asDisplayText } from '../../lib/sixHiOrderIdentity';

interface PlantOperationsAreaProps {
  data: ExtendedPlantHeadDashboardData;
  liveMachines?: MachineStatusCard[];
  liveOrders?: LiveOrderRow[];
  liveOrdersError?: string | null;
  onOrderClick?: (batchNumber: string) => void;
  onMachineClick?: (machineCode: string) => void;
}

function orderStatusTone(status: LiveOrderRow['status']) {
  if (status === 'IN_PROGRESS') return 'success' as const;
  if (status === 'STOPPAGE') return 'warning' as const;
  if (status === 'COMPLETED') return 'muted' as const;
  if (status === 'REJECTED') return 'accent' as const;
  return 'info' as const;
}

export function PlantOperationsArea({
  data,
  liveMachines,
  liveOrders,
  liveOrdersError,
  onOrderClick,
  onMachineClick,
}: PlantOperationsAreaProps) {
  const hasLiveMachines = liveMachines != null && liveMachines.length > 0;
  const hasLiveOrders = liveOrders != null && liveOrders.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="z-card text-card-foreground flex flex-col overflow-hidden">
        <div className="p-6 flex flex-col space-y-1.5 border-b border-border/50">
          <h2 className="font-semibold leading-none tracking-tight text-foreground">Machine Status</h2>
          <p className="text-sm text-muted-foreground">
            {hasLiveMachines
              ? 'Live machine cards from /live/snapshot — current order, runtime, and stoppages'
              : 'Live machine feed unavailable'}
          </p>
        </div>
        <div className="p-4 flex-1">
          {hasLiveMachines ? (
            <MachineStatusBoard machines={liveMachines!} onSelect={onMachineClick} />
          ) : data.lineAttainment.length > 0 ? (
            <>
              <div className="px-1 pb-3 text-xs text-muted-foreground">
                Showing plan attainment by process line (reporting window) — not live machine utilization
              </div>
              <table className="w-full text-left">
                <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Line</th>
                    <th className="px-5 py-3 font-medium text-right">Actual (MT)</th>
                    <th className="px-5 py-3 font-medium text-right">Plan attainment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.lineAttainment.map((line) => (
                    <tr key={line.lineId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 align-middle text-sm font-medium text-foreground">
                        {line.lineName}
                      </td>
                      <td className="px-5 py-3 align-middle text-right text-sm text-foreground">
                        {line.actualMt}
                      </td>
                      <td className="px-5 py-3 align-middle text-right text-sm font-semibold text-foreground">
                        {line.plannedMt > 0 ? `${line.attainmentPct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <DataUnavailable message="Live machine status and line attainment data are not available." />
          )}
        </div>
      </div>

      <div className="z-card text-card-foreground flex flex-col overflow-hidden">
        <div className="p-6 flex flex-col space-y-1.5 border-b border-border/50">
          <h2 className="font-semibold leading-none tracking-tight text-foreground">In Progress Orders</h2>
          <p className="text-sm text-muted-foreground">
            {hasLiveOrders
              ? 'Live queue from /live/orders (active work only)'
              : liveOrdersError
                ? 'Live order feed failed — retrying'
                : 'No active orders on the shopfloor right now'}
          </p>
        </div>
        <div className="p-0 flex-1 overflow-x-auto">
          {hasLiveOrders ? (
            <table className="w-full text-left">
              <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Coil / Order</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {liveOrders!.slice(0, 8).map((order) => (
                  <tr
                    key={order.batchNumber}
                    className={`hover:bg-muted/30 transition-colors ${onOrderClick ? 'cursor-pointer' : ''}`}
                    onClick={() => onOrderClick?.(order.batchNumber)}
                  >
                    <td className="px-5 py-3 align-middle">
                      <OrderIdentityDisplay order={order} size="sm" />
                      <div className="text-xs text-muted-foreground mt-1">
                        {order.machineName} · {order.currentProcess}
                      </div>
                    </td>
                    <td className="px-5 py-3 align-middle text-sm text-foreground">
                      {asDisplayText(order.customer) || '—'}
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <ZBadge tone={orderStatusTone(order.status)} label={formatOrderStatusLabel(order.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : liveOrdersError ? (
            <DataUnavailable message={`Could not load live orders: ${liveOrdersError}`} />
          ) : (
            <DataUnavailable message="No in-progress or queued orders on allocated machines." />
          )}
        </div>
      </div>
    </div>
  );
}
