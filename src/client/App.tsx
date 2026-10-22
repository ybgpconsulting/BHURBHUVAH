import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider, ProtectedRoute, RoleGuard } from './lib/auth';
import { ToastProvider } from './lib/toast';
import { Layout } from './components/Layout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const SetupPage = lazy(() => import('./pages/SetupPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const PlansPage = lazy(() => import('./pages/PlansPage'));
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage'));
const RoutesPage = lazy(() => import('./pages/RoutesPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const FollowUpsPage = lazy(() => import('./pages/FollowUpsPage'));
const DeliveryPartnerPage = lazy(() => import('./pages/DeliveryPartnerPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const MarketResearchPage = lazy(() => import('./pages/MarketResearchPage'));

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <React.Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading page...</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/deliveries" element={
              <ProtectedRoute>
                <DeliveryPartnerPage />
              </ProtectedRoute>
            } />
            <Route path="/*" element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/customers" element={<CustomersPage />} />
                    <Route path="/customers/:id" element={<CustomerDetailPage />} />
                    <Route path="/products" element={<ProductsPage />} />
                    <Route path="/plans" element={<PlansPage />} />
                    <Route path="/subscriptions" element={<SubscriptionsPage />} />
                    <Route path="/routes" element={<RoutesPage />} />
                    <Route path="/dispatch" element={<DispatchPage />} />
                    <Route path="/followups" element={<FollowUpsPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/market-research" element={
                      <RoleGuard allowedRoles={['owner', 'manager']}>
                        <MarketResearchPage />
                      </RoleGuard>
                    } />
                    <Route path="/users" element={
                      <RoleGuard allowedRoles={['owner']}>
                        <UsersPage />
                      </RoleGuard>
                    } />
                    <Route path="*" element={
                      <div className="p-6 text-sm text-gray-600">Page not found.</div>
                    } />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            } />
          </Routes>
        </React.Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
