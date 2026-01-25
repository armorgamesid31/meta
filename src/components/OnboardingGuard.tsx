import React, { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { apiFetch } from '../utils/apiFetch';

interface OnboardingGuardProps {
  children?: React.ReactNode;
}

const OnboardingGuard: React.FC<OnboardingGuardProps> = ({ children }) => {
  const salonToken = localStorage.getItem("salonToken");
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (salonToken) {
        try {
          // Check if salon has completed onboarding by checking if they have services
          const response = await fetch(`${API_BASE_URL}/api/salon/me`, {
            headers: { Authorization: `Bearer ${salonToken}` },
          });

          if (response.ok) {
            const data = await response.json();
            // Consider onboarded if salon has services (basic check)
            // In a real implementation, this would check a proper onboarding status
            setIsOnboarded(data.salon?.services?.length > 0 || false);
          } else {
            setIsOnboarded(false);
          }
        } catch (error) {
          setIsOnboarded(false);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };
    checkOnboardingStatus();
  }, [salonToken]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-500">Yükleniyor...</div>
    </div>;
  }

  if (!salonToken) {
    return <Navigate to="/salon/login" replace />;
  }

  if (isOnboarded === false) {
    return <Navigate to="/admin/onboarding" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};

export default OnboardingGuard;
