import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProcessSectionProps } from '../../lib/processSectionRegistry';

/** Legacy /shift-log/6HI route redirects to the 6HI hub. */
export function SixHiRedirect(_props: ProcessSectionProps) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/6hi', { replace: true });
  }, [navigate]);
  return null;
}
