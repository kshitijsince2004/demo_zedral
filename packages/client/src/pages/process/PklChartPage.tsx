import { PklChartGrid } from '../../components/process/bodies/PklChartGrid';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { ZButton } from '../../components/primitives/ZButton';
import { useNavigate } from 'react-router-dom';

export function PklChartPage() {
  const { basePath } = useProcessWorkspaceBase();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b flex justify-between items-center">
        <h1 className="font-bold">PKL Process Chart</h1>
        <ZButton type="button" variant="secondary" onClick={() => navigate(basePath)}>Back</ZButton>
      </div>
      <PklChartGrid />
    </div>
  );
}
