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
  className?: string;
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
  className,
}: ActualWeightCaptureFieldProps) {
  const native = isNative();
  const minConfidence = resolveOcrMinConfidence(ocrMinConfidence);
  const isOcr = ocr.actualWeightSource === 'ocr' && !!ocr.actualWeightPhotoHash;

  // Manual entry always allowed if form is not locked.
  const inputDisabled = formLocked;

  const handleCaptured = (r: WeightCaptureResult) => {
    onWeightConfirmed(r.value);
    onOcrChange({
      actualWeightSource: 'ocr',
      actualWeightPhotoHash: r.photoHash,
      ocrConfidence: r.confidence,
      ocrRawText: r.rawText,
    });
  };

  const handleClearOcr = () => {
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
      className={className}
    >
      <div className="flex gap-2 items-stretch">
        <div className="flex-1 min-w-0">
          <ZInput
            type="number"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              onDraftChange(e.target.value);
              // If they start typing over an OCR result, revert to manual source
              if (native && isOcr) {
                handleClearOcr();
              }
            }}
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
            recapture={isOcr}
            onCaptured={handleCaptured}
          />
        )}
      </div>
      {hint}
      {isOcr && ocr.ocrConfidence != null && (
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <p className="text-xs text-muted-foreground">
            OCR confirmed · confidence {ocr.ocrConfidence}%
          </p>
          <button
            type="button"
            className="text-[10px] uppercase font-bold text-primary hover:underline"
            onClick={handleClearOcr}
          >
            Clear Photo
          </button>
        </div>
      )}
    </FieldWrapper>
  );
}
