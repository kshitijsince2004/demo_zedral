import { useState } from 'react';
import { resolveOcrMinConfidence } from '@m1/shared-validation';
import type { ActualWeightOcrFields } from '@m1/shared-validation';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { isNative } from '../../operator/native/init';
import { WeightCaptureButton, type WeightCaptureResult } from './WeightCaptureButton';

export interface ActualWeightCaptureFieldProps {
  label: string;
  value: string;
  onDraftChange: (raw: string) => void;
  onDraftCommit: () => void;
  formLocked: boolean;
  ocr: ActualWeightOcrFields;
  onOcrChange: (next: ActualWeightOcrFields) => void;
  onWeightConfirmed: (value: number) => void;
  ocrMinConfidence?: number;
  prominent?: boolean;
  inputClassName: string;
  hint?: React.ReactNode;
}

/**
 * Actual Weight field with Android-only camera OCR capture.
 * Web builds keep a plain manual input.
 */
export function ActualWeightCaptureField({
  label,
  value,
  onDraftChange,
  onDraftCommit,
  formLocked,
  ocr,
  onOcrChange,
  onWeightConfirmed,
  ocrMinConfidence,
  prominent,
  inputClassName,
  hint,
}: ActualWeightCaptureFieldProps) {
  const native = isNative();
  const minConfidence = resolveOcrMinConfidence(ocrMinConfidence);
  const ocrLocked = native && ocr.actualWeightSource === 'ocr' && !!ocr.actualWeightPhotoHash;
  const [manualUnlocked, setManualUnlocked] = useState(ocr.actualWeightSource === 'manual');
  const [captureFailed, setCaptureFailed] = useState(false);

  // Confirmed OCR → readOnly until re-capture or supervisor override.
  const inputDisabled = formLocked || (ocrLocked && !manualUnlocked);

  const showOverride =
    native
    && !formLocked
    && !manualUnlocked
    && (ocrLocked || captureFailed);

  const overrideMessage = captureFailed
    ? 'Camera/OCR unavailable — supervisor override for manual entry'
    : 'Supervisor override to enter weight manually';

  const handleCaptured = (r: WeightCaptureResult) => {
    setManualUnlocked(false);
    setCaptureFailed(false);
    onWeightConfirmed(r.value);
    onOcrChange({
      actualWeightSource: 'ocr',
      actualWeightPhotoHash: r.photoHash,
      ocrConfidence: r.confidence,
      ocrRawText: r.rawText,
    });
  };

  const handleOverride = () => {
    setManualUnlocked(true);
    setCaptureFailed(false);
    onOcrChange({
      actualWeightSource: 'manual',
      actualWeightPhotoHash: undefined,
      ocrConfidence: undefined,
      ocrRawText: undefined,
    });
  };

  return (
    <FieldWrapper
      key={`${ocr.actualWeightSource ?? 'none'}-${ocr.actualWeightPhotoHash ?? 'none'}`}
      label={label}
      prominent={prominent}
      isWarning={showOverride || undefined}
      error={showOverride ? overrideMessage : undefined}
      onOverride={handleOverride}
    >
      <div className="flex gap-2 items-stretch">
        <div className="flex-1 min-w-0">
          <ZInput
            type="number"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            value={value}
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={onDraftCommit}
            className={inputClassName}
            disabled={inputDisabled}
            readOnly={inputDisabled}
          />
        </div>
        {native && !formLocked && (
          <WeightCaptureButton
            disabled={formLocked}
            minConfidence={minConfidence}
            recapture={ocrLocked}
            onCaptured={handleCaptured}
            onError={() => setCaptureFailed(true)}
          />
        )}
      </div>
      {hint}
      {ocrLocked && !manualUnlocked && ocr.ocrConfidence != null && (
        <p className="text-xs text-muted-foreground mt-1">
          OCR confirmed · confidence {ocr.ocrConfidence}%
        </p>
      )}
    </FieldWrapper>
  );
}
