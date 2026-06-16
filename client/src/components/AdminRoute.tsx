/**
 * AdminRoute — client-side route guard that redirects non-admin users to /403.
 *
 * This is a defence-in-depth layer. The server already enforces admin-only
 * access via `adminProcedure`, but this component prevents non-admins from
 * even seeing the admin page UI while the API call is in flight.
 *
 * Usage in App.tsx:
 *   <Route path="/admin/users" component={() => (
 *     <AdminRoute><UsersAdminPage /></AdminRoute>
 *   )} />
 */

import { useAuth } from '@/_core/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { useLocation } from 'wouter';

interface AdminRouteProps {
  children: ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') {
      navigate('/403', { replace: true });
    }
    if (!loading && !user) {
      navigate('/login', { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return null;
  }

  return <>{children}</>;
}
