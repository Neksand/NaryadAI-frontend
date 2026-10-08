import { Suspense, lazy, useEffect, useRef } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuthStore, roleHome } from './store/auth-store';
import { getRefreshToken, refreshSession } from './lib/api-client';
import { fetchMe } from './api/auth';
import { SkeletonList } from './components/ui';

const Login = lazy(() => import('./pages/Login'));
const WorkerHome = lazy(() => import('./pages/WorkerHome'));
const WorkerOrder = lazy(() => import('./pages/WorkerOrder'));
const MasterShift = lazy(() => import('./pages/MasterShift'));
const MasterBoard = lazy(() => import('./pages/MasterBoard'));
const MasterNew = lazy(() => import('./pages/MasterNew'));
const MasterOrder = lazy(() => import('./pages/MasterOrder'));
const MasterReview = lazy(() => import('./pages/MasterReview'));
const ManagerDashboard = lazy(() => import('./pages/ManagerDashboard'));
const Admin = lazy(() => import('./pages/Admin'));
const Notifications = lazy(() => import('./pages/Notifications'));

function RootRedirect() {
  const { user, role, bootstrapped } = useAuthStore();
  if (!bootstrapped) return <div className="p-4 max-w-3xl mx-auto"><SkeletonList /></div>;
  if (!user || !role) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(role)} replace />;
}

export default function App() {
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const store = useAuthStore.getState();
    // Восстановление сессии после перезагрузки: refresh (30 дней) → /me. Без этого — на /login.
    if (!store.user && getRefreshToken()) {
      refreshSession()
        .then((access) => {
          if (!access) return;
          return fetchMe()
            .then((user) => store.setSession(user, access, getRefreshToken()))
            .catch(() => { /* refresh ok, но /me упал — починит ретрай запросов */ });
        })
        .finally(() => store.setBootstrapped());
    } else {
      store.setBootstrapped();
    }
  }, []);
  return (
    <Suspense fallback={<div className="p-4 max-w-3xl mx-auto"><SkeletonList /></div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RootRedirect />} />

        <Route path="/worker" element={<ProtectedRoute allow={['worker']}><WorkerHome /></ProtectedRoute>} />
        <Route path="/worker/history" element={<ProtectedRoute allow={['worker']}><WorkerHome /></ProtectedRoute>} />
        <Route path="/worker/orders/:id" element={<ProtectedRoute allow={['worker']}><WorkerOrder /></ProtectedRoute>} />

        <Route path="/master" element={<ProtectedRoute allow={['master', 'admin']}><MasterShift /></ProtectedRoute>} />
        <Route path="/master/board" element={<ProtectedRoute allow={['master', 'admin']}><MasterBoard /></ProtectedRoute>} />
        <Route path="/master/new" element={<ProtectedRoute allow={['master', 'admin']}><MasterNew /></ProtectedRoute>} />
        <Route path="/master/orders/:id" element={<ProtectedRoute allow={['master', 'admin']}><MasterOrder /></ProtectedRoute>} />
        <Route path="/master/review/:id" element={<ProtectedRoute allow={['master', 'admin']}><MasterReview /></ProtectedRoute>} />

        <Route path="/manager" element={<ProtectedRoute allow={['manager', 'admin']}><ManagerDashboard /></ProtectedRoute>} />
        <Route path="/manager/areas" element={<ProtectedRoute allow={['manager', 'admin']}><ManagerDashboard /></ProtectedRoute>} />
        <Route path="/manager/equipment" element={<ProtectedRoute allow={['manager', 'admin']}><ManagerDashboard /></ProtectedRoute>} />

        <Route path="/admin" element={<ProtectedRoute allow={['admin']}><Admin /></ProtectedRoute>} />

        <Route path="/notifications" element={<ProtectedRoute allow={['worker', 'master', 'manager', 'admin']}><Notifications /></ProtectedRoute>} />

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}
