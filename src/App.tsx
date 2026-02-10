import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage.js';
import RegisterPage from './pages/RegisterPage.js';
import LoginPage from './pages/LoginPage.js';
import ProtectedRoute from './components/ProtectedRoute.js';
import OnboardingGuard from './components/OnboardingGuard.js';
import AdminLayout from './components/AdminLayout.js';
import OnboardingWizard from './pages/admin/OnboardingWizard.js';
import MagicLinkBooking from './pages/MagicLinkBooking.js';
import SalonLogin from './pages/salon/SalonLogin.js';
import SalonDashboard from './pages/salon/SalonDashboard.js';
import SalonSettings from './pages/salon/SalonSettings.js';
import SalonServices from './pages/salon/SalonServices.js';
import SalonStaff from './pages/salon/SalonStaff.js';
import SalonAppointments from './pages/salon/SalonAppointments.js';
import { BookingPage } from './booking/BookingPage.js';

function App() {
  return (
    <Router>
      <Routes>
        {/* Home Page */}
        <Route path="/" element={<HomePage />} />

        {/* Registration */}
        <Route path="/register" element={<RegisterPage />} />

        {/* Login */}
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
        <Route path="/salon/dashboard" element={
          <OnboardingGuard>
            <SalonDashboard />
          </OnboardingGuard>
        } />
        <Route path="/salon/settings" element={
          <OnboardingGuard>
            <SalonSettings />
          </OnboardingGuard>
        } />
        <Route path="/salon/services" element={
          <OnboardingGuard>
            <SalonServices />
          </OnboardingGuard>
        } />
        <Route path="/salon/staff" element={
          <OnboardingGuard>
            <SalonStaff />
          </OnboardingGuard>
        } />
        <Route path="/salon/appointments" element={
          <OnboardingGuard>
            <SalonAppointments />
          </OnboardingGuard>
        } />

        {/* Magic Link Booking - No authentication required */}
        <Route path="/m/:token" element={<MagicLinkBooking />} />
        <Route path="/magic-link" element={<MagicLinkBooking />} />
        
        {/* New Booking Flow */}
        <Route path="/booking" element={<BookingPage />} />
        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </Router>
  );
}

export default App;
