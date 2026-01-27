import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

interface Staff {
  id: number;
  name: string;
  enabled: boolean;
}

interface StaffFormProps {
  onSubmit: (staff: Omit<Staff, 'id' | 'enabled'>) => void;
  onCancel: () => void;
  loading: boolean;
  initialData?: Partial<Staff>;
}

const StaffForm: React.FC<StaffFormProps> = ({ onSubmit, onCancel, loading, initialData }) => {
  const [name, setName] = useState(initialData?.name || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Personel Adı *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Ahmet Yılmaz"
          required
          data-testid="staff-name-input"
        />
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

const SalonStaff: React.FC = () => {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadStaff();
  }, []);

  const loadStaff = async () => {
    try {
      const response = await fetch('/api/salon/staff', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStaff(data.staff);
      }
    } catch (error) {
      console.error('Error loading staff:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleStaff = async (staffId: number, enabled: boolean) => {
    setUpdating(staffId);
    setError(null);

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
      } else {
        setError('Personel durumu güncellenemedi');
      }
    } catch (error) {
      console.error('Error updating staff:', error);
      setError('Bağlantı hatası oluştu');
    } finally {
      setUpdating(null);
    }
  };

  const addStaff = async (staffData: Omit<Staff, 'id' | 'enabled'>) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/salon/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        },
        body: JSON.stringify(staffData)
      });

      if (response.ok) {
        const data = await response.json();
        setStaff([...staff, { ...data.staff, enabled: true }]);
        setShowAddForm(false);
      } else {
        setError('Personel eklenemedi');
      }
    } catch (error) {
      console.error('Error adding staff:', error);
      setError('Bağlantı hatası oluştu');
    } finally {
      setSaving(false);
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
              <h1 className="text-2xl font-bold text-gray-900">Personel</h1>
              <p className="mt-1 text-sm text-gray-600">
                Salonunuzun personelini yönetin
              </p>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              data-testid="staff-add-button"
            >
              Personel Ekle
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800 text-sm">{error}</div>
          </div>
        )}

        {/* Add Staff Form */}
        {showAddForm && (
          <div className="mb-6 bg-white shadow rounded-md p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Yeni Personel Ekle</h3>
            <StaffForm
              onSubmit={addStaff}
              onCancel={() => setShowAddForm(false)}
              loading={saving}
            />
          </div>
        )}

        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          {staff.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Henüz personel bulunmuyor.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {staff.map(person => (
                <li key={person.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-gray-900">
                        {person.name}
                      </h3>
                    </div>
                    <div className="flex items-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mr-3 ${
                        person.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {person.enabled ? 'Aktif' : 'Pasif'}
                      </span>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={person.enabled}
                          onChange={(e) => toggleStaff(person.id, e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          data-testid="staff-toggle"
                        />
                        <span className="ml-2 text-sm text-gray-700">
                          {person.enabled ? 'Devre dışı bırak' : 'Aktifleştir'}
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

export default SalonStaff;