import React from 'react';
import { type Tone, toneRail } from '../../lib/tones';

interface PulseDotProps {
  tone?: Tone;
}

export function PulseDot({ tone = 'success' }: PulseDotProps) {
  return (
    <span className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse-dot ${toneRail[tone]}`} />
  );
}
