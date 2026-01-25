import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

interface Staff {
  id: number;
  name: string;
  enabled: boolean;
}

const SalonStaff: React.FC = () => {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

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
        alert('Personel durumu güncellenemedi');
      }
    } catch (error) {
      console.error('Error updating staff:', error);
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
          <h1 className="text-2xl font-bold text-gray-900">Personel</h1>
          <p className="mt-1 text-sm text-gray-600">
            Salonunuzun personelini yönetin
          </p>
        </div>

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