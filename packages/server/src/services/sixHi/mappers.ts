/** Destination / finish mappers extracted from SixHiService (SAFE_CHANGE #19). */

export function mapDestination(raw: string | null): 'REWINDING' | 'ANNEALING' {
  return raw === 'REWINDING' ? 'REWINDING' : 'ANNEALING';
}

export function mapRollFinish(raw: string | null): 'MATT' | 'BRIGHT' | 'LOW_MATT' {
  if (raw === 'BRIGHT') return 'BRIGHT';
  if (raw === 'LOW_MATT') return 'LOW_MATT';
  return 'MATT';
}
