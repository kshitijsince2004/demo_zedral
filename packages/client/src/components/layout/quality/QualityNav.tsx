import { FileSpreadsheet, FlaskConical, GitBranch, Pin, PlusCircle, ShieldAlert } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { DeskSideNav, type DeskNavItem } from '../shared/DeskSideNav';

function tabOf(search: string): string {
  return new URLSearchParams(search).get('tab') || 'specs';
}

export function QualityNav() {
  const location = useLocation();
  const tab = tabOf(location.search);
  const onList = location.pathname === '/quality/specs';
  const onEditor = /^\/quality\/specs\/[^/]+/.test(location.pathname);

  const items: DeskNavItem[] = [
    {
      id: 'specs',
      label: 'Spec sheets',
      icon: FileSpreadsheet,
      path: '/quality/specs',
      match: () => onEditor || (onList && tab === 'specs'),
    },
    {
      id: 'create',
      label: 'New spec',
      icon: PlusCircle,
      path: '/quality/specs?tab=create',
      match: () => onList && tab === 'create',
    },
    {
      id: 'catalog',
      label: 'Parameter catalog',
      icon: FlaskConical,
      path: '/quality/specs?tab=catalog',
      match: () => onList && tab === 'catalog',
    },
    {
      id: 'process',
      label: 'Process sheets',
      icon: GitBranch,
      path: '/quality/specs?tab=process',
      match: () => onList && tab === 'process',
    },
    {
      id: 'qc',
      label: 'QC fails',
      icon: ShieldAlert,
      path: '/quality/specs?tab=qc',
      match: () => onList && tab === 'qc',
    },
    {
      id: 'repin',
      label: 'Re-pin order',
      icon: Pin,
      path: '/quality/specs?tab=repin',
      match: () => onList && tab === 'repin',
    },
  ];

  return (
    <DeskSideNav
      brandLabel="QUALITY"
      brandSubtitle="Spec & process sheets"
      items={items}
      ariaLabel="Quality navigation"
    />
  );
}
