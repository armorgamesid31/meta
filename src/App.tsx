import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import OnboardingGuard from './components/OnboardingGuard';
import AdminLayout from './components/AdminLayout';
import OnboardingWizard from './pages/admin/OnboardingWizard';
import MagicLinkBooking from './pages/MagicLinkBooking';
import SalonLogin from './pages/salon/SalonLogin';
import SalonDashboard from './pages/salon/SalonDashboard';
import SalonSettings from './pages/salon/SalonSettings';
import SalonServices from './pages/salon/SalonServices';
import SalonStaff from './pages/salon/SalonStaff';
import SalonAppointments from './pages/salon/SalonAppointments';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Onboarding Wizard rotası - kimlik doğrulaması gerektirir, ancak onboarding yapılmamışsa erişilebilir */}
        <Route path="/admin/onboarding" element={
          <ProtectedRoute>
            <OnboardingWizard />
          </ProtectedRoute>
        } />

        <Route path="/admin" element={
          <ProtectedRoute>
            <OnboardingGuard>
              <AdminLayout />
            </OnboardingGuard>
          </ProtectedRoute>
        } />

        {/* Salon Panel Routes */}
        <Route path="/salon/login" element={<SalonLogin />} />
        <Route path="/salon/dashboard" element={<SalonDashboard />} />
        <Route path="/salon/settings" element={<SalonSettings />} />
        <Route path="/salon/services" element={<SalonServices />} />
        <Route path="/salon/staff" element={<SalonStaff />} />
        <Route path="/salon/appointments" element={<SalonAppointments />} />

        {/* Magic Link Booking - No authentication required */}
        <Route path="/m" element={<MagicLinkBooking />} />

        {/* Müşteri Uygulaması Rotası - Henüz uygulanmadı, sadece yer tutucu */}
        <Route path="/book" element={<div>Customer Booking (Work in progress)</div>} />
        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </Router>
  );
}

export default App;
