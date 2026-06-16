/**
 * Forbidden.tsx — 403 Access Denied page
 *
 * Shown when a user without admin privileges attempts to access an admin-only
 * route via AdminRoute. Provides a clear explanation and escape routes.
 */

import BISLayout from '@/components/BISLayout';
import { Button } from '@/components/ui/button';
import { ShieldOff, ArrowLeft, Home } from 'lucide-react';
import { useLocation } from 'wouter';

function ForbiddenInner() {
  const [, navigate] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      {/* Icon */}
      <div className="flex items-center justify-center w-20 h-20 rounded-full bg-destructive/10 border border-destructive/20">
        <ShieldOff className="text-destructive" size={36} />
      </div>

      {/* Heading */}
      <div className="space-y-2 max-w-md">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          403 — Access Denied
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          You do not have the required permissions to view this page. This area
          is restricted to <strong>administrators</strong> only.
        </p>
        <p className="text-muted-foreground text-xs">
          If you believe this is an error, please contact your system
          administrator or the BIS platform owner to request elevated access.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => window.history.back()}
        >
          <ArrowLeft size={15} />
          Go Back
        </Button>
        <Button
          variant="default"
          className="gap-2"
          onClick={() => navigate('/dashboard')}
        >
          <Home size={15} />
          Return to Dashboard
        </Button>
      </div>

      {/* Reference code */}
      <p className="text-xs text-muted-foreground/50 font-mono">
        HTTP 403 Forbidden · BIS Platform
      </p>
    </div>
  );
}

export default function Forbidden() {
  return (
    <BISLayout title="Access Denied" subtitle="403 Forbidden">
      <ForbiddenInner />
    </BISLayout>
  );
}
