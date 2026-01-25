import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

interface SalonSettings {
  id: number;
  name: string;
  workStartHour: number;
  workEndHour: number;
  slotInterval: number;
}

interface Service {
  id: number;
  name: string;
  price: number;
  duration: number;
  enabled: boolean;
}

interface Staff {
  id: number;
  name: string;
  enabled: boolean;
}

const SalonSettings: React.FC = () => {
  const [settings, setSettings] = useState<SalonSettings | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load salon settings
      const settingsResponse = await fetch('/api/salon/me', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json();
        setSettings(settingsData.salon);
      }

      // Load services
      const servicesResponse = await fetch('/api/salon/services', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (servicesResponse.ok) {
        const servicesData = await servicesResponse.json();
        setServices(servicesData.services);
      }

      // Load staff
      const staffResponse = await fetch('/api/salon/staff', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (staffResponse.ok) {
        const staffData = await staffResponse.json();
        setStaff(staffData.staff);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async () => {
    if (!settings) return;

    setSaving(true);
    try {
      const response = await fetch('/api/salon/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        },
        body: JSON.stringify({
          workStartHour: settings.workStartHour,
          workEndHour: settings.workEndHour,
          slotInterval: settings.slotInterval
        })
      });

      if (response.ok) {
        alert('Ayarlar kaydedildi!');
      } else {
        alert('Ayarlar kaydedilemedi!');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Hata oluştu!');
    } finally {
      setSaving(false);
    }
  };

  const toggleService = async (serviceId: number, enabled: boolean) => {
    try {
      const response = await fetch('/api/salon/services', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        },
        body: JSON.stringify({
          serviceId,
          enabled
        })
      });

      if (response.ok) {
        setServices(services.map(s =>
          s.id === serviceId ? { ...s, enabled } : s
        ));
      }
    } catch (error) {
      console.error('Error updating service:', error);
    }
  };

  const toggleStaff = async (staffId: number, enabled: boolean) => {
    try {
      const response = await fetch('/api/salon/staff', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        },
        body: JSON.stringify({
          staffId,
          enabled
        })
      });

      if (response.ok) {
        setStaff(staff.map(s =>
          s.id === staffId ? { ...s, enabled } : s
        ));
      }
    } catch (error) {
      console.error('Error updating staff:', error);
    }
  };

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
          <h1 className="text-2xl font-bold text-gray-900">Salon Ayarları</h1>
          <p className="mt-1 text-sm text-gray-600">
            Çalışma saatlerinizi, hizmetlerinizi ve personel ayarlarınızı yönetin
          </p>
        </div>

        {/* Working Hours */}
        <div className="bg-white shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Çalışma Saatleri
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Başlangıç Saati
                </label>
                <select
                  value={settings?.workStartHour || 9}
                  onChange={(e) => setSettings(prev => prev ? {
                    ...prev,
                    workStartHour: parseInt(e.target.value)
                  } : null)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 6).map(hour => (
                    <option key={hour} value={hour}>{hour}:00</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Bitiş Saati
                </label>
                <select
                  value={settings?.workEndHour || 18}
                  onChange={(e) => setSettings(prev => prev ? {
                    ...prev,
                    workEndHour: parseInt(e.target.value)
                  } : null)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 12).map(hour => (
                    <option key={hour} value={hour}>{hour}:00</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Randevu Aralığı (dk)
                </label>
                <select
                  value={settings?.slotInterval || 30}
                  onChange={(e) => setSettings(prev => prev ? {
                    ...prev,
                    slotInterval: parseInt(e.target.value)
                  } : null)}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value={15}>15 dakika</option>
                  <option value={30}>30 dakika</option>
                  <option value={60}>1 saat</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <button
                onClick={updateSettings}
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
              >
                {saving ? 'Kaydediliyor...' : 'Çalışma Saatlerini Kaydet'}
              </button>
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="bg-white shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Hizmetler
            </h3>
            <div className="space-y-3">
              {services.map(service => (
                <div key={service.id} className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <h4 className="font-medium">{service.name}</h4>
                    <p className="text-sm text-gray-600">
                      {service.duration} dk - ₺{service.price}
                    </p>
                  </div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={service.enabled}
                      onChange={(e) => toggleService(service.id, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm">Aktif</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Staff */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Personel
            </h3>
            <div className="space-y-3">
              {staff.map(person => (
                <div key={person.id} className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <h4 className="font-medium">{person.name}</h4>
                  </div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={person.enabled}
                      onChange={(e) => toggleStaff(person.id, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm">Aktif</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SalonLayout>
  );
};

export default SalonSettings;