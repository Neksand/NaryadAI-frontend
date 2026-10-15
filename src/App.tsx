import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { BootScreen, ErrorBoundary } from './components/Boot';
import { useAuthStore, roleHome } from './store/auth-store';
import { getRefreshToken, isNetworkFailure, refreshSession } from './lib/api-client';
import { fetchMe } from './api/auth';

const Login = lazy(() => import('./pages/Login'));
const WorkerHome = lazy(() => import('./pages/WorkerHome'));
const WorkerOrder = lazy(() => import('./pages/WorkerOrder'));
const WorkerProfile = lazy(() => import('./pages/WorkerProfile'));
const MasterShift = lazy(() => import('./pages/MasterShift'));
const MasterBoard = lazy(() => import('./pages/MasterBoard'));
const MasterNew = lazy(() => import('./pages/MasterNew'));
const MasterOrder = lazy(() => import('./pages/MasterOrder'));
const MasterReview = lazy(() => import('./pages/MasterReview'));
const ManagerDashboard = lazy(() => import('./pages/ManagerDashboard'));
const Equipment = lazy(() => import('./pages/Equipment'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Admin = lazy(() => import('./pages/Admin'));
const Notifications = lazy(() => import('./pages/Notifications'));

const BOOT_TIMEOUT_MS = 9000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function RootRedirect() {
  const { user, role, bootstrapped } = useAuthStore();
  if (!bootstrapped) return <BootScreen />;
  if (!user || !role) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(role)} replace />;
}

export default function App() {
  const { t } = useTranslation();
  const booted = useRef(false);
  const [bootFailed, setBootFailed] = useState(false);
  useEffect(() => {
    const retryOfflineSession = () => {
      const store = useAuthStore.getState();
      const refresh = getRefreshToken();
      if (!store.user || store.accessToken || !refresh) return;
      const userId = store.user.id;
      void refreshSession()
        .then(async (access) => {
          if (!access) return;
          const resumedRefresh = getRefreshToken();
          const user = await fetchMe();
          // A delayed reconnect must not restore a session after logout or account change.
          if (useAuthStore.getState().user?.id !== userId || getRefreshToken() !== resumedRefresh)
            return;
          useAuthStore.getState().setSession(user, access, getRefreshToken());
        })
        .catch(() => {
          // Leave the read-only cached identity available if the API is still down.
        });
    };
    window.addEventListener('online', retryOfflineSession);
    return () => window.removeEventListener('online', retryOfflineSession);
  }, []);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const store = useAuthStore.getState();
    // Страховка: бутстрап обязан завершиться за BOOT_TIMEOUT_MS,
    // иначе вместо вечного скелета показываем Login с кнопкой повтора.
    const guard = setTimeout(() => {
      if (!useAuthStore.getState().bootstrapped) {
        setBootFailed(true);
        useAuthStore.getState().setBootstrapped();
      }
    }, BOOT_TIMEOUT_MS);
    const done = () => {
      clearTimeout(guard);
      store.setBootstrapped();
    };
    // Восстановление сессии после перезагрузки: refresh (30 дней) → /me. Без этого — на /login.
    if (!store.user && getRefreshToken()) {
      withTimeout(refreshSession(), BOOT_TIMEOUT_MS - 1000)
        .then(async (access) => {
          if (!access) {
            if (getRefreshToken()) store.restoreCachedSession();
            return null;
          }
          try {
            const user = await withTimeout(fetchMe(), 4000);
            if (user) store.setSession(user, access, getRefreshToken());
            else if (getRefreshToken()) store.restoreCachedSession();
            return user;
          } catch (error) {
            if (isNetworkFailure(error) && getRefreshToken()) store.restoreCachedSession();
            return null;
          }
        })
        .catch(() => null)
        .finally(done);
    } else {
      done();
    }
    return () => clearTimeout(guard);
  }, []);
  return (
    <ErrorBoundary>
      <Suspense fallback={<BootScreen />}>
        {bootFailed && (
          <div className="banner banner-warn mx-4 mt-3" role="alert">
            {t('boot.noSession')}
          </div>
        )}
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RootRedirect />} />

          <Route
            path="/worker"
            element={
              <ProtectedRoute allow={['worker']}>
                <WorkerHome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/history"
            element={
              <ProtectedRoute allow={['worker']}>
                <WorkerHome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/profile"
            element={
              <ProtectedRoute allow={['worker']}>
                <WorkerProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/orders/:id"
            element={
              <ProtectedRoute allow={['worker']}>
                <WorkerOrder />
              </ProtectedRoute>
            }
          />

          <Route
            path="/master"
            element={
              <ProtectedRoute allow={['master', 'admin']}>
                <MasterShift />
              </ProtectedRoute>
            }
          />
          <Route
            path="/master/board"
            element={
              <ProtectedRoute allow={['master', 'admin']}>
                <MasterBoard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/master/new"
            element={
              <ProtectedRoute allow={['master', 'admin']}>
                <MasterNew />
              </ProtectedRoute>
            }
          />
          <Route
            path="/master/orders/:id"
            element={
              <ProtectedRoute allow={['master', 'admin']}>
                <MasterOrder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/master/review/:id"
            element={
              <ProtectedRoute allow={['master', 'admin']}>
                <MasterReview />
              </ProtectedRoute>
            }
          />

          <Route
            path="/manager"
            element={
              <ProtectedRoute allow={['manager', 'admin']}>
                <ManagerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manager/areas"
            element={
              <ProtectedRoute allow={['manager', 'admin']}>
                <ManagerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manager/equipment"
            element={
              <ProtectedRoute allow={['manager', 'admin']}>
                <ManagerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/equipment/:id"
            element={
              <ProtectedRoute allow={['master', 'manager', 'admin']}>
                <Equipment />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assistant"
            element={
              <ProtectedRoute allow={['master', 'manager', 'admin']}>
                <Assistant />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute allow={['admin']}>
                <Admin />
              </ProtectedRoute>
            }
          />

          <Route
            path="/notifications"
            element={
              <ProtectedRoute allow={['worker', 'master', 'manager', 'admin']}>
                <Notifications />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
