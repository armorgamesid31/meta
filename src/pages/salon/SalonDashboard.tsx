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
  const [phoneNumber, setPhoneNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const createBookingLink = async () => {
    setCreating(true);
    setCreatedLink(null);

    try {
      const response = await fetch('/api/salon/magic-link/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        },
        body: JSON.stringify({
          phone: phoneNumber
        })
      });

      if (response.ok) {
        const data = await response.json();
        setCreatedLink(data.magicUrl);
        setPhoneNumber(''); // Clear the input
      } else {
        const error = await response.json();
        alert(`Hata: ${error.message}`);
      }
    } catch (error) {
      console.error('Error creating booking link:', error);
      alert('Bağlantı oluşturulamadı');
    } finally {
      setCreating(false);
    }
  };

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

        {/* Magic Link Creator */}
        <div className="mt-8">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Randevu Bağlantısı Oluştur</h2>
            <p className="text-sm text-gray-600 mb-4">
              Müşteriye göndereceğiniz randevu alma bağlantısını oluşturun
            </p>

            <div className="flex space-x-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Telefon Numarası
                </label>
                <input
                  type="tel"
                  placeholder="05551234567"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={createBookingLink}
                  disabled={creating || !phoneNumber}
                  className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {creating ? 'Oluşturuluyor...' : 'Bağlantı Oluştur'}
                </button>
              </div>
            </div>

            {createdLink && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-800 mb-2">Randevu bağlantısı oluşturuldu:</p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={createdLink}
                    readOnly
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded bg-white"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(createdLink)}
                    className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700"
                  >
                    Kopyala
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SalonLayout>
  );
};

export default SalonDashboard;