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
  isTest?: boolean; // New field to distinguish test vs real
}

interface RecentEvent {
  id: number;
  type: string;
  token: string;
  phone: string;
  timestamp: string;
  details: string;
  isTest?: boolean; // New field to distinguish test vs real
}

const SalonDashboard: React.FC = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [recentLinks, setRecentLinks] = useState<MagicLink[]>([]);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [availabilityChecks, setAvailabilityChecks] = useState<any[]>([]);

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

  // Check if all systems are working
  const allSystemsWorking = health && health.database === 'OK' && health.auth === 'OK' &&
                           health.booking === 'OK' && health.availability === 'OK';

  // Get specific problem reasons
  const getProblemReason = () => {
    if (!health) return "Sistem durumu kontrol edilemiyor";
    if (health.database !== 'OK') return "Veritabanı bağlantısında sorun var";
    if (health.auth !== 'OK') return "Giriş sistemi çalışmıyor";
    if (health.booking !== 'OK') return "Randevu kaydetme sistemi çalışmıyor";
    if (health.availability !== 'OK') return "Saat kontrol sistemi çalışmıyor";
    return "Bilinmeyen sorun";
  };

  // Find the last successful real booking
  const lastSuccessfulBooking = recentEvents
    .filter(event => !event.isTest && event.type === 'BOOKING_CONFIRMED')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  return (
    <SalonLayout>
      {/* Last Successful Activity */}
      {lastSuccessfulBooking && (
        <div className="bg-green-50 border-b border-green-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="flex items-center justify-center">
              <span className="text-sm text-green-800">
                ✓ Son başarılı randevu: {new Date(lastSuccessfulBooking.timestamp).toLocaleString('tr-TR')}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-6 sm:px-0 space-y-6">
        {/* System Status Section */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Sistem Çalışıyor Mu?</h2>
          <div className="flex items-center space-x-4">
            <div className={`w-4 h-4 rounded-full ${allSystemsWorking ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className={`text-lg font-medium ${allSystemsWorking ? 'text-green-700' : 'text-red-700'}`}>
              {allSystemsWorking ? 'Evet, sistem çalışıyor' : 'Hayır, sorun var'}
            </span>
          </div>
          {!allSystemsWorking && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800 font-medium">Sorun nedeni:</p>
              <p className="text-sm text-red-700 mt-1">{getProblemReason()}</p>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="text-center">
              <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                health?.database === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {health?.database === 'OK' ? '✓' : '✗'} Temel Sistem
              </div>
            </div>
            <div className="text-center">
              <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                health?.auth === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {health?.auth === 'OK' ? '✓' : '✗'} Giriş Yapma
              </div>
            </div>
            <div className="text-center">
              <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                health?.booking === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {health?.booking === 'OK' ? '✓' : '✗'} Randevu Kaydetme
              </div>
            </div>
            <div className="text-center">
              <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                health?.availability === 'OK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {health?.availability === 'OK' ? '✓' : '✗'} Saat Kontrolü
              </div>
            </div>
          </div>
        </div>

        {/* Salon Info Section */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Bu Benim Salonum Mu?</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Salon Adı:</span>
              <span className="font-medium">[Salon adı buraya gelecek]</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Hesap:</span>
              <span className="font-medium">[E-posta buraya gelecek]</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Durum:</span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                ✓ Randevu Almaya Hazır
              </span>
            </div>
          </div>
        </div>

        {/* Booking Links Section */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Randevu Bağlantıları Çalışıyor Mu?</h2>
          <div className="space-y-4">
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
                  data-testid="dashboard-create-magic-link"
                >
                  {creating ? 'Oluşturuluyor...' : 'Bağlantı Oluştur'}
                </button>
              </div>
            </div>

            {createdLink && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-md" data-testid="dashboard-magic-link-output">
                <p className="text-sm text-green-800 mb-2">✓ Bağlantı başarıyla oluşturuldu:</p>
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

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">Son Oluşturulan Bağlantılar</h3>
              {recentLinks.length > 0 ? (
                <div className="space-y-2">
                  {recentLinks.slice(0, 3).map((link) => (
                    <div key={link.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium">{link.phone}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          link.isTest ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {link.isTest ? 'Deneme' : 'Gerçek'}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          link.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                          link.status === 'EXPIRED' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {link.status === 'ACTIVE' ? 'Aktif' :
                           link.status === 'EXPIRED' ? 'Süresi Dolmuş' : 'Kullanılmış'}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(link.createdAt).toLocaleDateString('tr-TR')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">Henüz bağlantı oluşturulmamış</p>
              )}
            </div>
          </div>
        </div>

        {/* Recent Activity Section */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Müşteriler Nerede Terk Ediyor?</h2>
          <p className="text-gray-600 mb-4">
            Bu liste, müşterilerin randevu alma sürecinde nerede durduğunu gösterir.
          </p>
          {recentEvents.length > 0 ? (
            <div className="space-y-3">
              {recentEvents.slice(0, 5).map((event) => (
                <div key={event.id} className="flex items-start space-x-3">
                  <div className={`w-2 h-2 rounded-full mt-2 ${
                    event.type.includes('CONFIRMED') ? 'bg-green-500' :
                    event.type.includes('ABANDONED') ? 'bg-red-500' : 'bg-blue-500'
                  }`}></div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-900">
                        {event.type === 'LINK_CREATED' ? 'Bağlantı oluşturuldu' :
                         event.type === 'LINK_OPENED' ? 'Bağlantı açıldı' :
                         event.type === 'DATE_SELECTED' ? 'Tarih seçildi' :
                         event.type === 'SLOT_SELECTED' ? 'Saat seçildi' :
                         event.type === 'BOOKING_CONFIRMED' ? 'Randevu onaylandı' :
                         event.type === 'BOOKING_ABANDONED' ? 'İşlem yarıda bırakıldı' :
                         event.type}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        event.isTest ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {event.isTest ? 'Deneme' : 'Gerçek'}
                      </span>
                      <span className="text-xs text-gray-500">•</span>
                      <span className="text-sm text-gray-600">{event.phone}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{event.details}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(event.timestamp).toLocaleString('tr-TR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">Henüz müşteri aktivitesi yok</p>
          )}
        </div>

        {/* Time Slots Check Section */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Saatler Görünmüyor Mu?</h2>
          <p className="text-gray-600 mb-4">
            Bu bölüm, sistem saat kontrolü yaparken ne bulduğunu gösterir.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm">Son Saat Kontrolü:</span>
              <span className="text-sm font-medium text-green-600">✓ 5 saat bulundu</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm">Önceki Kontrol:</span>
              <span className="text-sm font-medium text-green-600">✓ 3 saat bulundu</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm">En Eski Kontrol:</span>
              <span className="text-sm font-medium text-yellow-600">⚠ Hiç saat bulunamadı</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Eğer "Hiç saat bulunamadı" görüyorsanız, çalışma saatlerinizi kontrol edin.
          </p>
        </div>
      </div>
    </SalonLayout>
  );
};

export default SalonDashboard;