import { Link, useLocation } from 'react-router-dom';

function labelFor(segment: string): string {
  return segment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {parts.map((part, index) => {
          const path = `/${parts.slice(0, index + 1).join('/')}`;
          const isLast = index === parts.length - 1;
          return (
            <li key={path} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">/</span>}
              {isLast ? (
                <span className="font-medium text-foreground">{labelFor(part)}</span>
              ) : (
                <Link to={path} className="hover:text-foreground">
                  {labelFor(part)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
