import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { syncSubscription } from '../lib/push';

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  // Once authenticated, refresh this device's push subscription row (endpoints
  // rotate; iOS drops them on reinstall). Best-effort, gated on a session so the
  // RLS-protected write actually lands.
  useEffect(() => {
    if (session) void syncSubscription();
  }, [session]);

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 'var(--app-h)' }}>
        <span className="text-muted">Lädt…</span>
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
