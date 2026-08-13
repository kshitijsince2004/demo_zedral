import { useEffect, useCallback, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Preferences } from '@capacitor/preferences';
import debounce from 'lodash/debounce';

interface UseFormDraftOptions {
  debounceMs?: number;
  onRestored?: () => void;
}

export function useFormDraft(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>,
  draftKey: string | null,
  options: UseFormDraftOptions = {}
) {
  const { debounceMs = 800, onRestored } = options;
  const lastWrittenRef = useRef<string | null>(null);

  const clearDraft = useCallback(async () => {
    if (!draftKey) return;
    lastWrittenRef.current = null;
    await Preferences.remove({ key: `draft_${draftKey}` });
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;

    async function load() {
      const res = await Preferences.get({ key: `draft_${draftKey}` });
      if (cancelled || !res.value) return;

      try {
        const parsed = JSON.parse(res.value);
        if (Object.keys(parsed).length > 0) {
          lastWrittenRef.current = res.value;
          form.reset(parsed);
          onRestored?.();
        }
      } catch (err) {
        console.warn(`Failed to parse draft for ${draftKey}`, err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [draftKey, form, onRestored]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const save = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debounce(async (data: any) => {
      if (!draftKey) return;
      const serialized = JSON.stringify(data);
      if (serialized === lastWrittenRef.current) return;
      lastWrittenRef.current = serialized;
      await Preferences.set({ key: `draft_${draftKey}`, value: serialized });
    }, debounceMs),
    [draftKey, debounceMs]
  );

  useEffect(() => {
    if (!draftKey) return;
    const subscription = form.watch((value) => {
      save(value);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [draftKey, form, save]);

  useEffect(() => {
    return () => {
      // Flush any pending debounced write before tearing down so the last
      // keystroke isn't lost, then cancel to prevent a stray post-unmount call.
      save.flush();
      save.cancel();
    };
  }, [save]);

  return { clearDraft };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useManualDraft<T extends Record<string, any>>(
  values: T,
  setValues: (values: T) => void,
  draftKey: string | null,
  options: UseFormDraftOptions = {}
) {
  const { debounceMs = 800, onRestored } = options;
  const lastWrittenRef = useRef<string | null>(null);

  const clearDraft = useCallback(async () => {
    if (!draftKey) return;
    lastWrittenRef.current = null;
    await Preferences.remove({ key: `draft_${draftKey}` });
  }, [draftKey]);

  const hasLoaded = useRef(false);

  // Load draft on mount
  useEffect(() => {
    if (!draftKey || hasLoaded.current) return;
    let cancelled = false;

    async function load() {
      const res = await Preferences.get({ key: `draft_${draftKey}` });
      if (cancelled || !res.value) return;

      try {
        const parsed = JSON.parse(res.value);
        if (Object.keys(parsed).length > 0) {
          hasLoaded.current = true;
          lastWrittenRef.current = res.value;
          setValues(parsed);
          onRestored?.();
        }
      } catch (err) {
        console.warn(`Failed to parse draft for ${draftKey}`, err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]); // run on draftKey change only

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const save = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debounce(async (data: any) => {
      if (!draftKey) return;
      const serialized = JSON.stringify(data);
      if (serialized === lastWrittenRef.current) return;
      lastWrittenRef.current = serialized;
      await Preferences.set({ key: `draft_${draftKey}`, value: serialized });
    }, debounceMs),
    [draftKey, debounceMs]
  );

  // Save draft on change
  useEffect(() => {
    if (!draftKey) return;
    save(values);
  }, [draftKey, values, save]);

  useEffect(() => {
    return () => {
      save.flush();
      save.cancel();
    };
  }, [save]);

  return { clearDraft };
}

