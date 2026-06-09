import { useState, useEffect } from 'react';
import { computeEffectiveRuleset } from '@m1/shared-validation';
import type { EffectiveRuleset, ValidationRule } from '@m1/shared-validation';
import { validationConfigService } from '../services/validationConfigService';

// Module-level cache to share ruleset across instances
let cachedRules: ValidationRule[] | null = null;
let cachedVersion: number = 0;
let lastFetch = 0;
let fetchPromise: Promise<void> | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useEffectiveRuleset() {
  const [effectiveRuleset, setEffectiveRuleset] = useState<EffectiveRuleset | null>(
    cachedRules ? computeEffectiveRuleset(cachedRules, cachedVersion) : null
  );
  const [loading, setLoading] = useState<boolean>(!cachedRules);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadRules = async () => {
      const now = Date.now();

      // Use cache if fresh
      if (cachedRules && (now - lastFetch < CACHE_TTL)) {
        if (mounted && loading) {
          setLoading(false);
        }
        return;
      }

      // If already fetching, wait for it
      if (fetchPromise) {
        await fetchPromise;
        if (mounted) {
          setEffectiveRuleset(computeEffectiveRuleset(cachedRules!, cachedVersion));
          setLoading(false);
        }
        return;
      }

      // Otherwise fetch
      fetchPromise = (async () => {
        try {
          const [rules, version] = await Promise.all([
            validationConfigService.getConfiguredRules(),
            validationConfigService.getVersion()
          ]);
          cachedRules = rules;
          cachedVersion = version;
          lastFetch = Date.now();
        } catch (err) {
          if (mounted) {
            setError(err instanceof Error ? err : new Error(String(err)));
          }
        } finally {
          fetchPromise = null;
        }
      })();

      await fetchPromise;
      if (mounted && cachedRules) {
        setEffectiveRuleset(computeEffectiveRuleset(cachedRules, cachedVersion));
        setLoading(false);
      }
    };

    loadRules();

    return () => {
      mounted = false;
    };
  }, []);

  return { effectiveRuleset, loading, error };
}
