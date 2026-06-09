import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { getMachineNavItems, pathForMachine } from '../../lib/machineRouting';
import { isCrmMillCode } from '../../lib/millConfig';
import { userScopePath } from '../../lib/userScope';

interface ProcessLineSwitcherProps {
  activeCode: string;
  className?: string;
}

export function ProcessLineSwitcher({ activeCode, className = '' }: ProcessLineSwitcherProps) {
  const navigate = useNavigate();
  const { role, lineAccess, machineAccess, username, setActiveMachine } = useAuthStore();

  const workspace = username && role ? { username, role } : null;
  const items = getMachineNavItems(role, machineAccess, lineAccess, username);
  if (items.length <= 1) return null;

  const go = (code: string) => {
    if (workspace && isCrmMillCode(code)) {
      setActiveMachine(code);
      navigate(userScopePath(workspace.username, workspace.role));
      return;
    }
    navigate(pathForMachine(code, workspace));
  };

  return (
    <div className={`flex gap-0.5 flex-wrap ${className}`}>
      {items.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => go(code)}
          className={[
            'min-h-10 px-4 text-xs font-bold rounded-full border transition-colors',
            activeCode === code
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:text-foreground',
          ].join(' ')}
        >
          {code}
          <span className="hidden sm:inline text-muted-foreground font-normal normal-case tracking-normal ml-1">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
