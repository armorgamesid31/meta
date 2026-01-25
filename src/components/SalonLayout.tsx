import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

interface SalonUser {
  id: number;
  email: string;
  role: string;
  salonId: number;
}

const SalonLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SalonUser | null>(null);
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
    { name: 'Randevular', href: '/salon/appointments', current: location.pathname === '/salon/appointments' },
    { name: 'Ayarlar', href: '/salon/settings', current: location.pathname === '/salon/settings' },
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

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
};

export default SalonLayout;