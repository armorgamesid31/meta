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
        setLoading(true); // Set loading to true before each check
        try {
          // Use single source of truth from /api/salon/me
          const response = await fetch(`${API_BASE_URL}/api/salon/me`, {
            headers: { Authorization: `Bearer ${salonToken}` },
          });

          if (response.ok) {
            const data = await response.json();
            // Use onboardingComplete from API (single source of truth)
            setIsOnboarded(data.salon?.onboardingComplete || false);
          } else {
            setIsOnboarded(false);
          }
        } catch (error) {
          setIsOnboarded(false);
        } finally {
          setLoading(false);
        }
      } else {
        setIsOnboarded(null);
        setLoading(false);
      }
    };

    checkOnboardingStatus();
  }, [salonToken]); // Re-run when salonToken changes

  // Also check onboarding status when component mounts or location changes
  // This handles the case where salon data changes after onboarding completion
  useEffect(() => {
    if (salonToken && !loading) {
      // Re-check onboarding status periodically or when needed
      const recheckOnboarding = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/salon/me`, {
            headers: { Authorization: `Bearer ${salonToken}` },
          });

          if (response.ok) {
            const data = await response.json();
            const currentOnboardingComplete = data.salon?.onboardingComplete || false;

            // Update state if it changed
            if (currentOnboardingComplete !== isOnboarded) {
              setIsOnboarded(currentOnboardingComplete);
            }
          }
        } catch (error) {
          console.error('Error rechecking onboarding status:', error);
        }
      };

      // Check immediately and then periodically
      recheckOnboarding();
      const interval = setInterval(recheckOnboarding, 2000); // Check every 2 seconds

      return () => clearInterval(interval);
    }
  }, [salonToken, loading, isOnboarded]);

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
