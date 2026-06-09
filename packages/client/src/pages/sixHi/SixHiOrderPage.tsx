import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';

/** Deep-link fallback: opens Orders with workspace modal for the batch. */
export function SixHiOrderPage() {
  const { batchNo } = useParams<{ batchNo: string }>();
  const navigate = useNavigate();
  const { basePath: base } = useWorkspaceBase();

  useEffect(() => {
    if (batchNo) {
      navigate(`${base}?open=${encodeURIComponent(decodeURIComponent(batchNo))}`, { replace: true });
    } else {
      navigate(base, { replace: true });
    }
  }, [batchNo, base, navigate]);

  return null;
}
