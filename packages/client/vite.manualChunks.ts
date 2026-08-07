/** Shared Rollup manualChunks for desk + operator Vite builds (PERF-A2). */
export function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  const n = id.replace(/\\/g, '/');
  if (n.includes('recharts') || n.includes('/d3-') || n.includes('/d3/')) return 'charts';
  if (n.includes('xlsx') || n.includes('exceljs')) return 'sheets';
  if (n.includes('supertokens')) return 'auth';
  if (n.includes('react-router') || n.includes('react-dom') || /\/react\//.test(n)) return 'react';
  return 'vendor';
}
