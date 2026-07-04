import { useCallback, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import { apiClient } from '../lib/apiClient';
import { ZBadge } from '../components/primitives/ZBadge';

export function SetupPage() {
  const [status, setStatus] = useState<string>('Waiting for barcode scan…');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const bufferRef = useRef<string>('');
  const timeoutRef = useRef<number | null>(null);

  const processBarcode = useCallback(async (barcode: string) => {
    if (!barcode.startsWith('BIND-')) {
      setError(`Invalid barcode format: ${barcode}`);
      return;
    }

    const processCode = barcode.split('-')[1];
    setStatus(`Registering device for process: ${processCode}…`);
    setError(null);

    try {
      const data = await apiClient.post<{ deviceId: string; processCode: string }>(
        '/device/register',
        { processCode },
      );

      localStorage.setItem('deviceId', data.deviceId);
      localStorage.setItem('deviceProcessCode', data.processCode);

      setStatus(`Success — device bound to ${data.processCode}. Redirecting…`);

      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setStatus('Waiting for barcode scan…');
    }
  }, [navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }

      if (e.key === 'Enter') {
        const barcode = bufferRef.current;
        if (barcode.length > 3) {
          void processBarcode(barcode);
        }
        bufferRef.current = '';
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      } else if (e.key.length === 1) {
        bufferRef.current += e.key;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => {
          bufferRef.current = '';
        }, 50);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [processBarcode]);

  return (
    <div className="theme-operator min-h-screen flex flex-col bg-secondary text-foreground">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold tracking-tight text-accent">ZEDRAL</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Device provisioning
          </span>
        </div>
        <ZBadge tone="warning" label="Setup mode" />
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md border border-border bg-background rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3">
            <ScanLine className="h-5 w-5 text-accent shrink-0" aria-hidden />
            <div>
              <h1 className="text-base font-semibold tracking-tight">Terminal assignment</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Admin or supervisor login required · scan the BIND barcode
              </p>
            </div>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <div className="p-4 rounded-sm border border-border bg-secondary/40 font-mono text-sm min-h-[72px] flex items-center justify-center text-center">
              {status}
            </div>

            <p className="text-[10px] uppercase tracking-wider text-muted-foreground text-center">
              Expected format: BIND-6HI, BIND-4HI, …
            </p>

            {error && (
              <div className="p-3 rounded-sm bg-destructive/10 text-destructive border border-destructive/30 text-sm">
                {error}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
