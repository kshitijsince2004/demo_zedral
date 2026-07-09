import useSWR from 'swr';
import { apiClient } from '../../lib/apiClient';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { DEFECT_OTHER_CODE, resolveDefectCodes } from '../../lib/defectCodes';

interface DefectTagSelectorProps {
  selected: string[];
  onToggle: (code: string) => void;
  otherRemarks?: string;
  onOtherRemarksChange?: (value: string) => void;
  variant?: 'end' | 'reject';
  /** When false, defect codes are not fetched (e.g. closed modal). */
  enabled?: boolean;
}

export function DefectTagSelector({
  selected,
  onToggle,
  otherRemarks = '',
  onOtherRemarksChange,
  variant = 'end',
  enabled = true,
}: DefectTagSelectorProps) {
  const { data: defectsData, error, isLoading } = useSWR(
    enabled ? '/6hi/master/defect-codes' : null,
    async (url) => apiClient.get(url),
  );

  const masterDefects = resolveDefectCodes(defectsData).filter((d) => d.defectCode !== DEFECT_OTHER_CODE);
  const defects = resolveDefectCodes(defectsData);

  const selectedStyle =
    variant === 'reject'
      ? 'bg-destructive text-white border-destructive shadow-sm'
      : 'bg-warning text-foreground border-warning shadow-sm';

  if (enabled && isLoading && !defectsData) {
    return <p className="text-sm text-muted-foreground italic">Loading defect tags from master data…</p>;
  }

  if (error && masterDefects.length === 0) {
    return (
      <p className="text-sm text-destructive">
        Could not load defect codes. Check your connection or ask an admin to configure Master Data → Defect Codes.
      </p>
    );
  }

  if (masterDefects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No defect codes configured. An admin can add them under{' '}
        <span className="font-semibold text-foreground">Admin → Master Data → Defect Codes</span>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Tap to select · {masterDefects.length} tags from master data
      </p>
      <div className="rounded-xl border-2 border-border bg-secondary/30 p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {defects.map((d) => {
            const isSelected = selected.includes(d.defectCode);
            return (
              <button
                key={d.defectCode}
                type="button"
                onClick={() => onToggle(d.defectCode)}
                aria-pressed={isSelected}
                className={[
                  'min-h-11 w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-colors',
                  isSelected
                    ? selectedStyle
                    : 'bg-white text-foreground border-border hover:border-primary/40 hover:bg-secondary',
                ].join(' ')}
              >
                <span className="font-mono">{d.defectCode}</span>
                <span className="opacity-80"> — </span>
                <span>{d.defectName}</span>
              </button>
            );
          })}
        </div>
      </div>
      {selected.includes(DEFECT_OTHER_CODE) && onOtherRemarksChange && (
        <FieldWrapper label="Other defect remarks" required>
          <ZInput
            value={otherRemarks}
            onChange={(e) => onOtherRemarksChange(e.target.value)}
            placeholder="Describe the defect…"
            className="min-h-12 text-base"
          />
        </FieldWrapper>
      )}
    </div>
  );
}
