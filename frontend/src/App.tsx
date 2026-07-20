import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppLayout } from '@/components/layout/app-layout'
import { ProtectedRoute } from '@/features/auth/protected-route'
import { DinerProvider } from '@/features/diner/diner-context'

// Code-split every page so the initial bundle stays small and heavy deps
// (recharts, per-feature code) load only when their route is visited.
const DashboardOverview = lazy(() =>
  import('@/features/dashboard/overview').then((m) => ({ default: m.DashboardOverview }))
)
const MenuPage = lazy(() => import('@/features/menu/menu-page').then((m) => ({ default: m.MenuPage })))
const TablesPage = lazy(() =>
  import('@/features/tables/tables-page').then((m) => ({ default: m.TablesPage }))
)
const StaffPage = lazy(() => import('@/features/staff/staff-page').then((m) => ({ default: m.StaffPage })))
const PaymentsPage = lazy(() =>
  import('@/features/payments/payments-page').then((m) => ({ default: m.PaymentsPage }))
)
const FeedbackPage = lazy(() =>
  import('@/features/feedback/feedback-page').then((m) => ({ default: m.FeedbackPage }))
)
const SettingsPage = lazy(() =>
  import('@/features/settings/settings-page').then((m) => ({ default: m.SettingsPage }))
)
const LoginPage = lazy(() => import('@/features/auth/login-page').then((m) => ({ default: m.LoginPage })))
const RegisterRestaurantPage = lazy(() =>
  import('@/features/auth/register-restaurant-page').then((m) => ({ default: m.RegisterRestaurantPage }))
)
const VerifyOtpPage = lazy(() =>
  import('@/features/auth/verify-otp-page').then((m) => ({ default: m.VerifyOtpPage }))
)
const ForgotPasswordPage = lazy(() =>
  import('@/features/auth/forgot-password-page').then((m) => ({ default: m.ForgotPasswordPage }))
)
const ResetPasswordPage = lazy(() =>
  import('@/features/auth/reset-password-page').then((m) => ({ default: m.ResetPasswordPage }))
)

// KDS and Waiter each have their own layout — operational screens, not part of the manager dashboard.
const KdsLayout = lazy(() =>
  import('@/features/kds/kds-layout').then((m) => ({ default: m.KdsLayout }))
)
const KdsBoard = lazy(() => import('@/features/kds/kds-board').then((m) => ({ default: m.KdsBoard })))
const WaiterLayout = lazy(() =>
  import('@/features/waiter/waiter-layout').then((m) => ({ default: m.WaiterLayout }))
)
const WaiterBoard = lazy(() =>
  import('@/features/waiter/waiter-board').then((m) => ({ default: m.WaiterBoard }))
)
const CashierLayout = lazy(() =>
  import('@/features/cashier/cashier-layout').then((m) => ({ default: m.CashierLayout }))
)
const CashierBoard = lazy(() =>
  import('@/features/cashier/cashier-board').then((m) => ({ default: m.CashierBoard }))
)
// Diner (client) app — public, no auth, reached via the table QR code.
const DinerLayout = lazy(() =>
  import('@/features/diner/diner-layout').then((m) => ({ default: m.DinerLayout }))
)
const DinerMenu = lazy(() => import('@/features/diner/diner-menu').then((m) => ({ default: m.DinerMenu })))
const OrderTracking = lazy(() =>
  import('@/features/diner/order-tracking').then((m) => ({ default: m.OrderTracking }))
)

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterRestaurantPage />} />
        <Route path="/verify-otp" element={<VerifyOtpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Diner (client) app — public, reached by scanning a table QR */}
        <Route
          element={
            <DinerProvider>
              <DinerLayout />
            </DinerProvider>
          }
        >
          <Route path="/menu" element={<DinerMenu />} />
          <Route path="/order/track/:id" element={<OrderTracking />} />
        </Route>

        {/* Kitchen Display System — dedicated screen for cook / bar staff only.
            Managers use the dashboard; operational screens stay isolated. */}
        <Route
          element={
            <ProtectedRoute roles={['cook']}>
              <KdsLayout />
            </ProtectedRoute>
          }
        >
          <Route path="kds" element={<KdsBoard />} />
        </Route>

        {/* Waiter app — dedicated screen for serving staff only. */}
        <Route
          element={
            <ProtectedRoute roles={['waiter']}>
              <WaiterLayout />
            </ProtectedRoute>
          }
        >
          <Route path="waiter" element={<WaiterBoard />} />
        </Route>

        {/* Cashier app — dedicated checkout screen for cashier staff only. */}
        <Route
          element={
            <ProtectedRoute roles={['cashier']}>
              <CashierLayout />
            </ProtectedRoute>
          }
        >
          <Route path="cashier" element={<CashierBoard />} />
        </Route>

        {/* Manager dashboard */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardOverview />} />
          {/* Menu management lives at /menu-management so the public diner menu
              can keep the clean /menu path used by table QR codes. */}
          <Route path="menu-management" element={<MenuPage />} />
          <Route path="tables" element={<TablesPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
