import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

interface Service {
  id: number;
  name: string;
  price: number;
  duration: number;
  enabled: boolean;
}

const SalonServices: React.FC = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const response = await fetch('/api/salon/services', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setServices(data.services);
      }
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
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
      } else {
        alert('Hizmet durumu güncellenemedi');
      }
    } catch (error) {
      console.error('Error updating service:', error);
      alert('Hata oluştu');
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
          <h1 className="text-2xl font-bold text-gray-900">Hizmetler</h1>
          <p className="mt-1 text-sm text-gray-600">
            Salonunuzun hizmetlerini yönetin
          </p>
        </div>

        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          {services.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Henüz hizmet bulunmuyor.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {services.map(service => (
                <li key={service.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-gray-900">
                        {service.name}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {service.duration} dakika - ₺{service.price}
                      </p>
                    </div>
                    <div className="flex items-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mr-3 ${
                        service.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {service.enabled ? 'Aktif' : 'Pasif'}
                      </span>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={service.enabled}
                          onChange={(e) => toggleService(service.id, e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="ml-2 text-sm text-gray-700">
                          {service.enabled ? 'Devre dışı bırak' : 'Aktifleştir'}
                        </span>
                      </label>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SalonLayout>
  );
};

export default SalonServices;