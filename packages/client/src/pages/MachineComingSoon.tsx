import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getRoleHomePath } from '../lib/roleHome';
import { ZButton } from '../components/primitives/ZButton';

export function MachineComingSoon({ machineCode: machineCodeProp }: { machineCode?: string } = {}) {
  const navigate = useNavigate();
  const { machineCode: routeCode = '—' } = useParams<{ machineCode: string }>();
  const machineCode = machineCodeProp ?? routeCode;
  const { role, lineAccess, machineAccess, username, logout } = useAuthStore();
  const home = getRoleHomePath(role, lineAccess, machineAccess, username);

  // If the user's home path resolves to the current URL, or if they have no valid home,
  // "Back to home" is an infinite loop. We offer a logout option instead.
  const isAlreadyHome = window.location.pathname === home || 
                        home === '/coming-soon' ||
                        home === `/machine/${machineCode}` ||
                        home === `/coming-soon/${machineCode}`;

  const handleAction = () => {
    if (isAlreadyHome) {
      logout();
      navigate('/login');
    } else {
      navigate(home);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary p-6">
      <div className="max-w-md w-full bg-white border border-border rounded-2xl p-8 text-center space-y-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Coming soon</p>
        <h1 className="text-2xl font-bold font-mono text-foreground">{machineCode}</h1>
        <p className="text-sm text-muted-foreground">
          No CRM mill (6HI) is assigned to this account. Contact your machine head or admin to get machine access.
        </p>
        <ZButton variant="accent" onClick={handleAction}>
          {isAlreadyHome ? 'Logout' : 'Back to home'}
        </ZButton>
      </div>
    </div>
  );
}
