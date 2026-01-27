import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

interface Service {
  id: number;
  name: string;
  price: number;
  duration: number;
  enabled: boolean;
}

interface ServiceFormProps {
  onSubmit: (service: Omit<Service, 'id' | 'enabled'>) => void;
  onCancel: () => void;
  loading: boolean;
  initialData?: Partial<Service>;
}

const ServiceForm: React.FC<ServiceFormProps> = ({ onSubmit, onCancel, loading, initialData }) => {
  const [name, setName] = useState(initialData?.name || '');
  const [duration, setDuration] = useState(initialData?.duration || 30);
  const [price, setPrice] = useState(initialData?.price || 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, duration, price });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Hizmet Adı *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Saç Kesimi"
          required
          data-testid="service-name-input"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Süre (dakika) *
          </label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value) || 30)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="15"
            max="480"
            required
            data-testid="service-duration-input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fiyat (TL) *
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="0"
            required
          />
        </div>
      </div>

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
          disabled={loading}
        >
          İptal
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          disabled={loading || !name.trim()}
        >
          {loading ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </div>
    </form>
  );
};

const SalonServices: React.FC = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);

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
    setError(null);
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
        setError('Hizmet durumu güncellenemedi');
      }
    } catch (error) {
      console.error('Error updating service:', error);
      setError('Bağlantı hatası oluştu');
    }
  };

  const addService = async (serviceData: Omit<Service, 'id' | 'enabled'>) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/salon/services', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        },
        body: JSON.stringify(serviceData)
      });

      if (response.ok) {
        const data = await response.json();
        setServices([...services, { ...data.service, enabled: true }]);
        setShowAddForm(false);
      } else {
        setError('Hizmet eklenemedi');
      }
    } catch (error) {
      console.error('Error adding service:', error);
      setError('Bağlantı hatası oluştu');
    } finally {
      setSaving(false);
    }
  };

  const updateService = async (serviceId: number, serviceData: Omit<Service, 'id' | 'enabled'>) => {
    setSaving(true);
    setError(null);
    try {
      // For now, we'll use the existing PUT endpoint which only handles enabled/disabled
      // TODO: Add full update endpoint
      setError('Hizmet güncelleme henüz desteklenmiyor');
    } catch (error) {
      console.error('Error updating service:', error);
      setError('Bağlantı hatası oluştu');
    } finally {
      setSaving(false);
      setEditingService(null);
    }
  };

  const deleteService = async (serviceId: number) => {
    if (!confirm('Bu hizmeti silmek istediğinizden emin misiniz?')) return;

    setError(null);
    try {
      // TODO: Add DELETE endpoint
      setError('Hizmet silme henüz desteklenmiyor');
    } catch (error) {
      console.error('Error deleting service:', error);
      setError('Bağlantı hatası oluştu');
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
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Hizmetler</h1>
              <p className="mt-1 text-sm text-gray-600">
                Salonunuzun hizmetlerini yönetin
              </p>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              data-testid="service-add-button"
            >
              Hizmet Ekle
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800 text-sm">{error}</div>
          </div>
        )}

        {/* Add Service Form */}
        {showAddForm && (
          <div className="mb-6 bg-white shadow rounded-md p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Yeni Hizmet Ekle</h3>
            <ServiceForm
              onSubmit={addService}
              onCancel={() => setShowAddForm(false)}
              loading={saving}
            />
          </div>
        )}

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
                          data-testid="service-toggle"
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