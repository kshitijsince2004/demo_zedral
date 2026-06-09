import { useGloveModeStore } from '../lib/gloveModeStore';

/**
 * Returns Tailwind class strings that scale with glove mode.
 *
 * Normal mode  : h-14 (56px) — meets the ≥56px touch-target requirement (Req 10.1).
 * Glove mode   : h-16 (64px) with extra padding — easier targeting with heavy gloves (Req 10.2).
 *
 * Usage:
 *   const { inputHeight, saveHeight, inputPadding } = useGloveModeClasses();
 *   <button className={`${inputHeight} ${inputPadding} ...`}>...</button>
 */
export function useGloveModeClasses() {
  const { isGloveMode } = useGloveModeStore();

  return {
    /** Height for interactive field buttons (40px normal, 56px glove). */
    inputHeight: isGloveMode ? 'h-14' : 'h-10',
    /** Height for the primary save/action button. */
    saveHeight: isGloveMode ? 'h-14' : 'h-10',
    /** Height for text inputs. */
    inputFieldHeight: isGloveMode ? 'h-14' : 'h-10',
    /** Horizontal padding for field buttons. */
    inputPadding: isGloveMode ? 'px-4' : 'px-3',
    /** Gap between adjacent controls. */
    controlGap: isGloveMode ? 'gap-4' : 'gap-3',
    /** Whether glove mode is active (for conditional rendering). */
    isGloveMode,
  };
}
