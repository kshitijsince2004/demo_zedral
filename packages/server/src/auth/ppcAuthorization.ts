import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '@m1/shared-validation';
import { logAuthorizationDenied } from './authorizationAudit';

export type PpcOperation =
  | 'PPC_PREVIEW'
  | 'PPC_PREVIEW_MACHINES'
  | 'PPC_PREVIEW_COMMIT'
  | 'PPC_TRANSFER_MACHINE';

export function denyPlantHeadPpc(operation: PpcOperation) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });

    if (user.roles.includes(UserRole.PLANT_HEAD as string)) {
      void logAuthorizationDenied(user.id, UserRole.PLANT_HEAD, operation, 'ppc');
      return res.status(403).json({
        error: 'AUTHORIZATION_DENIED',
        message: 'Plant Head has read-only access. PP&C import is not permitted.',
        role: UserRole.PLANT_HEAD,
        operation,
      });
    }
    return next();
  };
}
