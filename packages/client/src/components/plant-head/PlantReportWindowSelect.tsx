import type { PlantReportWindow } from '../../hooks/usePlantHeadReportData';

export function PlantReportWindowSelect({
  value,
  onChange,
}: {
  value: PlantReportWindow;
  onChange: (v: PlantReportWindow) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as PlantReportWindow)}
      aria-label="Reporting time window"
      className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm"
    >
      <option value={1}>Last 24 Hours</option>
      <option value={7}>Last 7 Days</option>
      <option value={30}>Last 30 Days</option>
      <option value={90}>Last 90 Days</option>
    </select>
  );
}