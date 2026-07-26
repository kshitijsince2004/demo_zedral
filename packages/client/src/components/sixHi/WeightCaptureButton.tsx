import { useCallback, useEffect, useRef, useState } from 'react';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { TextRecognition, Script } from '@capacitor-mlkit/text-recognition';
import { parseWeightFromOcrText } from '@m1/shared-validation';
import { canvasToJpegBase64, preprocessWeightFrame, sha256Hex } from './weightOcrCapture';

export interface WeightCaptureResult {
  value: number;
  rawText: string;
  confidence: number;
  photoHash: string;
}

export interface WeightCaptureButtonProps {
  disabled?: boolean;
  minConfidence: number;
  onCaptured: (r: WeightCaptureResult) => void;
  onError?: (e: Error) => void;
  /** Label when a value is already locked (re-shoot). */
  recapture?: boolean;
}

type Phase = 'idle' | 'camera' | 'processing' | 'review';

function confidenceFromBlocks(blocks: Array<{ confidence?: number }> | undefined): number {
  // ponytail: @capacitor-mlkit/text-recognition TextBlock has no confidence; default 100 so
  // parse-success is the gate unless a future plugin version exposes scores.
  if (!blocks?.length) return 100;
  const vals = blocks
    .map((b) => b.confidence)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  if (!vals.length) return 100;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg <= 1 ? Math.round(avg * 100) : Math.round(avg);
}

export function WeightCaptureButton({
  disabled,
  minConfidence,
  onCaptured,
  onError,
  recapture,
}: WeightCaptureButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<WeightCaptureResult | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const fail = (err: Error) => {
    stopCamera();
    setPhase('idle');
    setPending(null);
    setError(err.message);
    onError?.(err);
  };

  const openCamera = async () => {
    setError(null);
    setPending(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase('camera');
      // Attach after paint
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
    } catch (e) {
      fail(e instanceof Error ? e : new Error('Camera permission denied'));
    }
  };

  const grabAndOcr = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      fail(new Error('Camera not ready'));
      return;
    }

    setPhase('processing');
    let tempPath: string | null = null;

    try {
      const raw = document.createElement('canvas');
      raw.width = video.videoWidth;
      raw.height = video.videoHeight;
      raw.getContext('2d')!.drawImage(video, 0, 0);
      stopCamera();

      const imageData = raw.getContext('2d')!.getImageData(0, 0, raw.width, raw.height);
      const photoHash = await sha256Hex(imageData.data);

      const processed = preprocessWeightFrame(raw);
      const base64 = canvasToJpegBase64(processed);
      const fileName = `weight-ocr-${Date.now()}.jpg`;
      const written = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Cache,
      });
      tempPath = written.uri;

      const result = await TextRecognition.processImage({
        path: tempPath,
        script: Script.Latin,
      });

      const rawText = result.text?.trim() ?? '';
      const value = parseWeightFromOcrText(rawText);
      if (value == null) {
        fail(new Error('Could not read a weight number — re-shoot'));
        return;
      }

      const confidence = confidenceFromBlocks(result.blocks as Array<{ confidence?: number }> | undefined);
      if (confidence < minConfidence) {
        fail(new Error(`Confidence ${confidence}% below threshold ${minConfidence}% — re-shoot`));
        return;
      }

      setPending({ value, rawText, confidence, photoHash });
      setPhase('review');
    } catch (e) {
      fail(e instanceof Error ? e : new Error('OCR failed'));
    } finally {
      if (tempPath) {
        try {
          await Filesystem.deleteFile({ path: tempPath });
        } catch {
          // best-effort cleanup; also try by cache filename
          try {
            const name = tempPath.split(/[/\\]/).pop();
            if (name) await Filesystem.deleteFile({ path: name, directory: Directory.Cache });
          } catch {
            /* ignore */
          }
        }
      }
    }
  };

  const confirm = () => {
    if (!pending) return;
    onCaptured(pending);
    setPending(null);
    setPhase('idle');
    setError(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={disabled || phase === 'processing'}
        onClick={() => void openCamera()}
        className="min-h-12 min-w-12 px-3 rounded-lg border border-border bg-secondary text-sm font-bold text-foreground disabled:opacity-50"
      >
        {recapture ? 'Re-capture' : 'Camera'}
      </button>
      {error && <p className="text-xs text-destructive font-medium">{error}</p>}

      {phase === 'camera' && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center p-4">
          <video ref={videoRef} playsInline muted className="max-h-[70vh] w-full max-w-3xl object-contain rounded-lg bg-black" />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              className="min-h-14 px-6 rounded-xl bg-white text-foreground font-bold text-base"
              onClick={() => void grabAndOcr()}
            >
              Capture
            </button>
            <button
              type="button"
              className="min-h-14 px-6 rounded-xl border border-white/40 text-white font-bold text-base"
              onClick={() => {
                stopCamera();
                setPhase('idle');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'processing' && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center">
          <p className="text-white text-lg font-bold">Reading weight…</p>
        </div>
      )}

      {phase === 'review' && pending && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl p-5 max-w-md w-full space-y-3 border border-border">
            <h3 className="text-base font-bold text-foreground">Confirm weight</h3>
            <p className="text-3xl font-mono font-bold text-foreground">{pending.value} MT</p>
            <p className="text-sm text-muted-foreground">
              Confidence {pending.confidence}% · raw: {pending.rawText || '—'}
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="flex-1 min-h-12 rounded-xl bg-primary text-white font-bold"
                onClick={confirm}
              >
                Confirm
              </button>
              <button
                type="button"
                className="flex-1 min-h-12 rounded-xl border border-border font-bold"
                onClick={() => {
                  setPending(null);
                  void openCamera();
                }}
              >
                Re-capture
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
