import React, { type ReactNode, useEffect, useState, useRef, useCallback } from 'react';

interface ZDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'small' | 'medium' | 'large';
  children: ReactNode;
}

export function ZDrawer({ open, onClose, title, size = 'medium', children }: ZDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const widthClass = size === 'small' ? 'w-80' : size === 'large' ? 'w-[800px]' : 'w-96';

  // Mount on open, then trigger visible for transition
  useEffect(() => {
    if (open) {
      setMounted(true);
      // RAF to ensure mount happens before transition starts
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [open]);

  // Unmount after exit transition
  const handleTransitionEnd = useCallback(() => {
    if (!visible) {
      setMounted(false);
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onClick={onClose}
        onTransitionEnd={handleTransitionEnd}
      />
      <div
        ref={panelRef}
        className={[
          `fixed inset-y-0 right-0 z-50 flex flex-col bg-card border-l border-border shadow-xl transition-transform duration-200 ease-out ${widthClass}`,
          visible ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        onTransitionEnd={handleTransitionEnd}
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-sm opacity-70 hover:opacity-100 hover:bg-muted transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {children}
        </div>
      </div>
    </>
  );
}
