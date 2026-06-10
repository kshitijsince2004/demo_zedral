import React from 'react';

interface IntelligenceComingSoonProps {
  title: string;
}

export function IntelligenceComingSoon({ title }: IntelligenceComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Coming Soon</p>
      <h1 className="text-2xl font-bold text-foreground mb-3">{title}</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        This module will be available in future releases.
      </p>
    </div>
  );
}
