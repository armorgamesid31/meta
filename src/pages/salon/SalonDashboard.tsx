import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';
import { apiGet, apiPost } from '../../utils/api';

interface SystemHealth {
  database: 'OK' | 'FAIL';
  auth: 'OK' | 'FAIL';
  booking: 'OK' | 'FAIL';
  availability: 'OK' | 'FAIL';
  lastCheck: string;
}

interface MagicLink {
  id: number;
  token: string;
  phone: string;
  status: 'ACTIVE' | 'EXPIRED' | 'USED';
  createdAt: string;
  expiresAt: string;
}

interface RecentEvent {
  id: number;
  type: string;
  token: string;
  phone: string;
  timestamp: string;
  details: string;
}

const SalonDashboard: React.FC = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [recentLinks, setRecentLinks] = useState<MagicLink[]>([]);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboardData = async () => {
    try {
      // Load system health
      const healthResponse = await apiGet('/api/admin/health');
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        setHealth(healthData);
      }

      // Load recent magic links
      const linksResponse = await apiGet('/api/admin/magic-links?limit=5');
      if (linksResponse.ok) {
        const linksData = await linksResponse.json();
        setRecentLinks(linksData.links || []);
      }

      // Load recent events
      const eventsResponse = await apiGet('/api/admin/events?limit=10');
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setRecentEvents(eventsData.events || []);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const createBookingLink = async () => {
    setCreating(true);
    setCreatedLink(null);

    try {
      const response = await apiPost('/api/salon/magic-link/booking', {
        phone: phoneNumber
      });

      if (response.ok) {
        const data = await response.json();
        setCreatedLink(data.magicUrl);
        setPhoneNumber('');
        // Reload dashboard data to show new link
        loadDashboardData();
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
    loadDashboardData();
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
      <div className="px-4 py-6 sm:px-0 space-y-6">
        {/* System Health */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Sistem Durumu</h2>
          {health ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  health.database === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {health.database === 'OK' ? '✓' : '✗'} Veritabanı
                </div>
              </div>
              <div className="text-center">
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  health.auth === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {health.auth === 'OK' ? '✓' : '✗'} Kimlik Doğrulama
                </div>
              </div>
              <div className="text-center">
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  health.booking === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {health.booking === 'OK' ? '✓' : '✗'} Randevu Yazma
                </div>
              </div>
              <div className="text-center">
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  health.availability === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {health.availability === 'OK' ? '✓' : '✗'} Uygunluk
                </div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Sistem durumu yüklenemedi</p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Son kontrol: {health?.lastCheck ? new Date(health.lastCheck).toLocaleString('tr-TR') : 'Bilinmiyor'}
          </p>
        </div>

        {/* Magic Link Creator */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Randevu Bağlantısı Oluştur</h2>
          <div className="flex space-x-4">
            <div className="flex-1">
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
                {creating ? 'Oluşturuluyor...' : 'Oluştur'}
              </button>
            </div>
          </div>

          {createdLink && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800 mb-2">Bağlantı oluşturuldu:</p>
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

        {/* Recent Magic Links */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Son Bağlantılar</h2>
          {recentLinks.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Token
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Telefon
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Durum
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Oluşturulma
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentLinks.map((link) => (
                    <tr key={link.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                        {link.token.substring(0, 8)}...
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {link.phone}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          link.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                          link.status === 'EXPIRED' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {link.status === 'ACTIVE' ? 'Aktif' :
                           link.status === 'EXPIRED' ? 'Süresi Dolmuş' : 'Kullanılmış'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(link.createdAt).toLocaleString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500">Henüz bağlantı oluşturulmamış</p>
          )}
        </div>

        {/* Recent Events */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Son Olaylar</h2>
          {recentEvents.length > 0 ? (
            <div className="space-y-2">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-900">{event.type}</span>
                      <span className="text-xs text-gray-500">•</span>
                      <span className="text-sm text-gray-600">{event.phone}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{event.details}</p>
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(event.timestamp).toLocaleString('tr-TR')}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">Henüz olay kaydedilmemiş</p>
          )}
        </div>
      </div>
    </SalonLayout>
  );
};

export default SalonDashboard;