import { useState, useCallback } from 'react';
import { useGloveModeClasses } from './useGloveModeClasses';

interface UseNumericCaptureOptions<T extends Record<string, unknown>> {
  values: T;
  setValue: (field: keyof T & string, value: unknown) => void;
  fieldLabels?: Record<string, string>;
  autoSourcedFields?: Set<string>;
  getValue?: (field: string) => string;
  setValueForField?: (field: string, raw: string) => void;
}

export function useNumericCapture<T extends Record<string, unknown>>({
  values,
  setValue,
  fieldLabels = {},
  autoSourcedFields,
  getValue,
  setValueForField,
}: UseNumericCaptureOptions<T>) {
  const { inputHeight, inputPadding, controlGap } = useGloveModeClasses();
  const [activeField, setActiveField] = useState<string | null>(null);

  const defaultGetValue = useCallback(
    (field: string): string => {
      const v = (values as Record<string, unknown>)[field];
      return v !== undefined && v !== 0 && v !== '' ? String(v) : '';
    },
    [values],
  );

  const defaultSetValue = useCallback(
    (field: string, raw: string) => {
      const n = parseFloat(raw);
      setValue(field as keyof T & string, raw === '' ? 0 : isNaN(n) ? undefined : n);
    },
    [setValue],
  );

  const getNumericValue = getValue ?? defaultGetValue;
  const setNumericValue = setValueForField ?? defaultSetValue;

  const fieldBtnClass = (field: string, hasError = false) =>
    [
      inputHeight,
      'flex-1 rounded-sm border text-sm font-mono text-left tabular-nums',
      inputPadding,
      'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
      hasError
        ? 'border-destructive/50 bg-destructive/10 text-destructive'
        : activeField === field
          ? 'border-accent bg-accent/10 text-accent'
          : autoSourcedFields?.has(field)
            ? 'border-success/40 bg-success/10 text-success'
            : 'border-border bg-background text-foreground hover:border-accent/30',
    ].join(' ');

  const activeFieldLabel = activeField ? fieldLabels[activeField] ?? activeField : undefined;

  return {
    activeField,
    setActiveField,
    getNumericValue,
    setNumericValue,
    fieldBtnClass,
    activeFieldLabel,
    inputHeight,
    inputPadding,
    controlGap,
  };
}
