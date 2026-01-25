import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from '../utils/api';

interface SalonUser {
  id: number;
  email: string;
  role: string;
  salonId: number;
}

interface SalonInfo {
  id: number;
  name: string;
  subscriptionStatus: 'trial' | 'active' | 'expired';
  onboardingComplete: boolean;
}

const SalonLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SalonUser | null>(null);
  const [salon, setSalon] = useState<SalonInfo | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const token = localStorage.getItem('salonToken');
    const userData = localStorage.getItem('salonUser');

    if (!token || !userData) {
      navigate('/salon/login');
      return;
    }

    try {
      const parsedUser = JSON.parse(userData);
      setUser(parsedUser);

      // Load salon info
      apiGet('/api/salon/me')
        .then(res => {
          if (!res.ok) {
            throw new Error('Salon bilgisi alınamadı');
          }
          return res.json();
        })
        .then(data => {
          if (data.salon) {
            setSalon(data.salon);
          }
        })
        .catch(error => {
          console.error('SalonLayout error:', error);
        });
    } catch (error) {
      navigate('/salon/login');
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('salonToken');
    localStorage.removeItem('salonUser');
    navigate('/salon/login');
  };

  if (!user) {
    return <div>Loading...</div>;
  }

  const navigation = [
    { name: 'Dashboard', href: '/salon/dashboard', current: location.pathname === '/salon/dashboard' },
    { name: 'Ayarlar', href: '/salon/settings', current: location.pathname === '/salon/settings' },
    { name: 'Hizmetler', href: '/salon/services', current: location.pathname === '/salon/services' },
    { name: 'Personel', href: '/salon/staff', current: location.pathname === '/salon/staff' },
    { name: 'Randevular', href: '/salon/appointments', current: location.pathname === '/salon/appointments' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-gray-900">Salon Panel</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`${
                      item.current
                        ? 'border-blue-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center">
              <span className="text-sm text-gray-700 mr-4">{user.email}</span>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
              >
                Çıkış
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Salon Context Header */}
      {salon && (
        <div className="bg-blue-50 border-b border-blue-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{salon.name}</h2>
                  <p className="text-sm text-gray-600">ID: {salon.id} • Sahip: {user.email}</p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    salon.subscriptionStatus === 'active' ? 'bg-green-100 text-green-800' :
                    salon.subscriptionStatus === 'trial' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {salon.subscriptionStatus === 'active' ? 'Aktif' :
                     salon.subscriptionStatus === 'trial' ? 'Deneme' : 'Süresi Dolmuş'}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    salon.onboardingComplete ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {salon.onboardingComplete ? 'Hazır' : 'Kurulum Gerekli'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
};

export default SalonLayout;