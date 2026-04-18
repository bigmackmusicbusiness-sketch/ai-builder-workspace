// packages/ui/patterns/PermissionGate.tsx — show/hide based on access level.
// Never reveal partial access. Provide a clear message when access is denied.
import * as React from 'react';

export interface PermissionGateProps {
  /** Whether the current user has access */
  allowed: boolean;
  /** What to show when access is denied. Default: null (hides entirely). */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  allowed,
  fallback = null,
  children,
}) => {
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
};
PermissionGate.displayName = 'PermissionGate';
