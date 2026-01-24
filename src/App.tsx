import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route path="/admin/*" element={
          <ProtectedRoute>
            <AdminLayout>
              <Routes>
                <Route path="dashboard" element={<div>Admin Dashboard Page</div>} />
                <Route path="calendar" element={<div>Admin Calendar Page</div>} />
                <Route path="settings" element={<div>Admin Settings Page</div>} />
                <Route path="*" element={<div>Admin 404 Not Found</div>} />
              </Routes>
            </AdminLayout>
          </ProtectedRoute>
        } />

        {/* Müşteri Uygulaması Rotası - Henüz uygulanmadı, sadece yer tutucu */}
        <Route path="/book" element={<div>Customer Booking (Work in progress)</div>} />
        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </Router>
  );
}

export default App;
