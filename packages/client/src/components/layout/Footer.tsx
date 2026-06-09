import React from 'react';

const services = ['SAP MB52', 'SAP MB51', 'Postgres', 'Redpanda', 'Readiness Worker'];

export function Footer() {
  return (
    <footer className="-mx-6 -mb-6 mt-auto bg-primary text-primary-foreground border-t border-primary-foreground/10">
      <div className="px-6 py-4 flex items-center gap-5 flex-wrap">
        {services.map((svc) => (
          <div key={svc} className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
            <span className="text-xs uppercase tracking-wider text-primary-foreground/70">{svc}</span>
          </div>
        ))}
        <div className="ml-auto">
          <span className="text-xs text-primary-foreground/50">v1.0.0</span>
        </div>
      </div>
    </footer>
  );
}
