import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';

interface ProtectedRouteProps {
  children?: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const isAuthenticated = localStorage.getItem('auth_token');

  if (!isAuthenticated) {
    // Kullanıcı kimliği doğrulanmamışsa, login sayfasına yönlendir
    return <Navigate to="/login" replace />;
  }

  // Kimliği doğrulanmışsa, çocuk bileşenleri render et
  return children ? <>{children}</> : <Outlet />;
};

export default ProtectedRoute;
