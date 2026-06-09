import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getRoleHomePath } from '../lib/roleHome';
import { ZButton } from '../components/primitives/ZButton';

export function MachineComingSoon() {
  const navigate = useNavigate();
  const { machineCode = '—' } = useParams<{ machineCode: string }>();
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
          This machine workspace is not available yet. Use your assigned CRM mill or line capture screen.
        </p>
        <ZButton variant="accent" onClick={handleAction}>
          {isAlreadyHome ? 'Logout' : 'Back to home'}
        </ZButton>
      </div>
    </div>
  );
}
