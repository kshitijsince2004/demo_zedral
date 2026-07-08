import { X } from 'lucide-react';
import { ExportJobPanel } from './ExportJobPanel';

interface ExportProgressModalProps {
  jobId: string;
  onClose: () => void;
}

export function ExportProgressModal({ jobId, onClose }: ExportProgressModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <h3 className="font-bold text-foreground">Export Progress</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          <ExportJobPanel jobId={jobId} onReset={onClose} />
        </div>
      </div>
    </div>
  );
}
