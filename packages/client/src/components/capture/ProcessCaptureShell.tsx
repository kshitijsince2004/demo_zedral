import type { ReactNode } from 'react';
import type { SaveOutcome, SaveStatus } from '../../hooks/useEntryForm';
import type { ValidationError } from '@m1/shared-validation';
import { CaptureWorkspace, type CaptureTab } from './CaptureWorkspace';
import { ZKeypad } from '../primitives/ZKeypad';
import { ZBadge } from '../primitives/ZBadge';
import { ReviewSubmitGate } from '../forms/ReviewSubmitGate';

interface ProcessCaptureShellProps {
  tabs: CaptureTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  summary: ReactNode;
  values: Record<string, unknown>;
  errors: ValidationError[];
  isDirty: boolean;
  saveStatus: SaveStatus;
  onSave: () => Promise<SaveOutcome>;
  activeField: string | null;
  activeFieldLabel?: string;
  getNumericValue: (field: string) => string;
  setNumericValue: (field: string, val: string) => void;
  statusExtras?: ReactNode;
  footerExtras?: ReactNode;
}

export function ProcessCaptureShell({
  tabs,
  activeTab,
  onTabChange,
  summary,
  values,
  errors,
  isDirty,
  saveStatus,
  onSave,
  activeField,
  activeFieldLabel,
  getNumericValue,
  setNumericValue,
  statusExtras,
  footerExtras,
}: ProcessCaptureShellProps) {
  const statusBar = (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/40 text-xs flex-wrap">
      {saveStatus === 'queued' && <ZBadge tone="warning" label="Queued" />}
      {saveStatus === 'transmitted' && <ZBadge tone="success" label="Transmitted" />}
      {saveStatus === 'failed' && <ZBadge tone="destructive" label="Save failed" />}
      {statusExtras}
    </div>
  );

  return (
    <CaptureWorkspace
      statusBar={statusBar}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      summary={summary}
      keypad={
        activeField ? (
          <ZKeypad
            value={getNumericValue(activeField)}
            onChange={(val) => setNumericValue(activeField, val)}
            activeLabel={activeFieldLabel}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Tap a numeric field to enter values
          </div>
        )
      }
      footer={
        <>
          <ReviewSubmitGate
            values={values}
            errors={errors}
            isDirty={isDirty}
            saveStatus={saveStatus}
            onSave={onSave}
          />
          {footerExtras}
        </>
      }
    />
  );
}

/** Single-tab shorthand for simpler process forms. */
export function SingleTabCaptureShell(
  props: Omit<ProcessCaptureShellProps, 'tabs' | 'activeTab' | 'onTabChange'> & {
    tabLabel?: string;
    children: ReactNode;
  },
) {
  const { tabLabel = 'Capture', children, ...rest } = props;
  return (
    <ProcessCaptureShell
      {...rest}
      tabs={[{ id: 'main', label: tabLabel, content: children }]}
      activeTab="main"
      onTabChange={() => {}}
    />
  );
}
