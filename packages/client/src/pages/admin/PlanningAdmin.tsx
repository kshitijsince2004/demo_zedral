/**
 * PlanningAdmin — Admin screen for SAP/CSV imports
 *
 * Requirements: 7.3, 7.4
 */
import { useState, useRef } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { adminService, type ImportSource, type ImportBatch } from '../../services/adminService';
import { StatusBadge } from '../../components/ui/StatusBadge';

export function PlanningAdmin() {
  const [source, setSource] = useState<ImportSource>('CSV');
  const [file, setFile] = useState<File | null>(null);
  const [ppcFile, setPpcFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [ppcLoading, setPpcLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ppcResult, setPpcResult] = useState<{ loaded: number; errors: { row: number; message: string }[]; status: string } | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ppcFileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminService.uploadImport(source, file);
      setBatch(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshBatch = async () => {
    if (!batch) return;
    setLoading(true);
    try {
      const updated = await adminService.getBatch(batch.id);
      setBatch(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to refresh batch');
    } finally {
      setLoading(false);
    }
  };

  const handlePpcUpload = async () => {
    if (!ppcFile) return;
    setPpcLoading(true);
    setError(null);
    try {
      const result = await adminService.uploadPpc(ppcFile);
      setPpcResult({ loaded: result.loaded, errors: result.errors, status: result.status });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'PPC upload failed');
    } finally {
      setPpcLoading(false);
    }
  };

  const handleDownloadErrors = async () => {
    if (!batch) return;
    try {
      const blob = await adminService.downloadErrorRows(batch.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `error_rows_${batch.id}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to download error rows');
    }
  };

  return (
    <AdminShell title="Planning Import" subtitle="SAP and CSV production plan staging">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AdminPanel title="Upload plan">
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Source</label>
              <select 
                value={source} 
                onChange={(e) => setSource(e.target.value as ImportSource)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="CSV">CSV Upload</option>
                <option value="SAP">SAP Export</option>
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">File</label>
              <input 
                type="file" 
                ref={fileInputRef}
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-primary file:text-primary-foreground
                  hover:file:bg-primary/90"
              />
            </div>

            {error && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}

            <ZButton
              variant="accent"
              fullWidth
              onClick={handleUpload}
              disabled={!file || loading}
            >
              {loading ? 'Uploading…' : 'Upload file'}
            </ZButton>
          </div>
        </AdminPanel>

        <AdminPanel title="CRM 6HI PPC Upload">
          <div className="p-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              Upload PPC sheet with batch_number, date, shift, machine, process, and coil fields.
              Phase 1: machine must be 6HI.
            </p>
            <input
              type="file"
              ref={ppcFileInputRef}
              accept=".csv"
              onChange={(e) => setPpcFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-muted-foreground
                file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
                file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground"
            />
            <ZButton variant="accent" fullWidth onClick={handlePpcUpload} disabled={!ppcFile || ppcLoading}>
              {ppcLoading ? 'Uploading…' : 'Upload PPC'}
            </ZButton>
            {ppcResult && (
              <div className="text-sm space-y-1">
                <p>Status: {ppcResult.status} — {ppcResult.loaded} loaded</p>
                {ppcResult.errors.length > 0 && (
                  <ul className="text-xs text-destructive max-h-32 overflow-auto">
                    {ppcResult.errors.map((e) => (
                      <li key={e.row}>Row {e.row}: {e.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </AdminPanel>

        {batch && (
          <AdminPanel
            title="Batch status"
            actions={
              <ZButton variant="ghost" size="sm" onClick={handleRefreshBatch} disabled={loading}>
                Refresh
              </ZButton>
            }
          >
            <div className="p-4 space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Batch ID</span>
                <span className="font-mono text-xs">{batch.id}</span>
              </div>
              
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge 
                  tone={
                    batch.status === 'LOADED' ? 'success' : 
                    batch.status === 'FAILED' ? 'destructive' : 
                    batch.status === 'PARTIAL' ? 'warning' : 'info'
                  } 
                  label={batch.status} 
                />
              </div>

              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Rows</span>
                <div className="text-sm text-right">
                  <div>{batch.loaded_rows} loaded</div>
                  <div className="text-destructive">{batch.error_count} errors</div>
                  <div className="text-xs text-muted-foreground">of {batch.total_rows} total</div>
                </div>
              </div>

              {batch.error_summary && (
                <div className="p-3 rounded-md bg-destructive/5 border border-destructive/10 mt-4">
                  <span className="text-xs font-semibold text-destructive uppercase">Error Summary</span>
                  <p className="text-xs mt-1 text-muted-foreground">{batch.error_summary}</p>
                </div>
              )}

              {(batch.status === 'PARTIAL' || batch.status === 'FAILED') && batch.error_count > 0 && (
                <ZButton variant="danger" fullWidth onClick={handleDownloadErrors}>
                  Download error rows
                </ZButton>
              )}
            </div>
          </AdminPanel>
        )}
      </div>
    </AdminShell>
  );
}
