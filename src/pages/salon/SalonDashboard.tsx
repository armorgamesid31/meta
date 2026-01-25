import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

interface DashboardStats {
  totalAppointments: number;
  todayAppointments: number;
  totalCustomers: number;
  totalRevenue: number;
}

const SalonDashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats>({
    totalAppointments: 0,
    todayAppointments: 0,
    totalCustomers: 0,
    totalRevenue: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // For now, just show placeholder stats
    // In a real implementation, you'd fetch from an API
    setStats({
      totalAppointments: 0,
      todayAppointments: 0,
      totalCustomers: 0,
      totalRevenue: 0
    });
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <SalonLayout>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Yükleniyor...</div>
        </div>
      </SalonLayout>
    );
  }

  return (
    <SalonLayout>
      <div className="px-4 py-6 sm:px-0">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">
            Salonunuzun genel durumuna göz atın
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">📅</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Toplam Randevu
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.totalAppointments}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">📆</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Bugünkü Randevular
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.todayAppointments}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">👥</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Toplam Müşteri
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.totalCustomers}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">💰</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Toplam Gelir
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      ₺{stats.totalRevenue}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Hızlı İşlemler</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-900">Randevu Oluştur</h3>
              <p className="mt-1 text-sm text-gray-500">
                Manuel randevu oluşturun
              </p>
              <button className="mt-3 bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">
                Oluştur
              </button>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-900">Müşteri Ekle</h3>
              <p className="mt-1 text-sm text-gray-500">
                Yeni müşteri kaydı oluşturun
              </p>
              <button className="mt-3 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">
                Ekle
              </button>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-900">Hizmet Ayarları</h3>
              <p className="mt-1 text-sm text-gray-500">
                Hizmetleri ve fiyatları düzenleyin
              </p>
              <button className="mt-3 bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700">
                Düzenle
              </button>
            </div>
          </div>
        </div>
      </div>
    </SalonLayout>
  );
};

export default SalonDashboard;