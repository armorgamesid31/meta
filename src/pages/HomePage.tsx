import React from 'react';
import { useNavigate } from 'react-router-dom';

const HomePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Salon Asistan</h1>
          <p className="text-lg text-gray-600 mb-8">
            Salonunuzu yönetin, randevuları kolaylaştırın
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => navigate('/salon/login')}
            className="w-full bg-blue-600 text-white py-4 px-6 rounded-lg text-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Giriş Yap
          </button>

          <button
            onClick={() => navigate('/register')}
            className="w-full bg-green-600 text-white py-4 px-6 rounded-lg text-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
            data-testid="landing-create-salon"
          >
            Yeni Salon Oluştur
          </button>
        </div>

        <div className="mt-8 text-sm text-gray-500">
          <p>Salonunuzu oluşturun ve randevu yönetimini başlatın</p>
        </div>
      </div>
    </div>
  );
};

export default HomePage;