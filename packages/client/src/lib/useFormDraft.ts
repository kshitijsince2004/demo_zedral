import { useEffect, useCallback } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Preferences } from '@capacitor/preferences';
import debounce from 'lodash/debounce';

interface UseFormDraftOptions {
  debounceMs?: number;
  onRestored?: () => void;
}

export function useFormDraft(
  form: UseFormReturn<any>,
  draftKey: string | null,
  options: UseFormDraftOptions = {}
) {
  const { debounceMs = 800, onRestored } = options;

  const clearDraft = useCallback(async () => {
    if (!draftKey) return;
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

  useEffect(() => {
    if (!draftKey) return;
    
    const save = debounce(async (data: any) => {
      await Preferences.set({ key: `draft_${draftKey}`, value: JSON.stringify(data) });
    }, debounceMs);

    const subscription = form.watch((value) => {
      save(value);
    });

    return () => {
      subscription.unsubscribe();
      save.cancel();
    };
  }, [draftKey, form, debounceMs]);

  return { clearDraft };
}

export function useManualDraft<T extends Record<string, any>>(
  values: T,
  setValues: (values: T) => void,
  draftKey: string | null,
  options: UseFormDraftOptions = {}
) {
  const { debounceMs = 800, onRestored } = options;

  const clearDraft = useCallback(async () => {
    if (!draftKey) return;
    await Preferences.remove({ key: `draft_${draftKey}` });
  }, [draftKey]);

  // Load draft on mount
  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;

    async function load() {
      const res = await Preferences.get({ key: `draft_${draftKey}` });
      if (cancelled || !res.value) return;

      try {
        const parsed = JSON.parse(res.value);
        if (Object.keys(parsed).length > 0) {
          setValues({ ...values, ...parsed });
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
  }, [draftKey]); // only run on draftKey change

  // Save draft on change
  useEffect(() => {
    if (!draftKey) return;
    
    const save = debounce(async (data: any) => {
      await Preferences.set({ key: `draft_${draftKey}`, value: JSON.stringify(data) });
    }, debounceMs);

    save(values);

    return () => {
      save.cancel();
    };
  }, [draftKey, values, debounceMs]);

  return { clearDraft };
}

