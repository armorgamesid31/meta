import React, { useEffect, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

interface Appointment {
  id: number;
  datetime: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  customer: {
    name: string;
    phone: string;
  };
  services: Array<{
    name: string;
    price?: number;
  }>;
}

const SalonAppointments: React.FC = () => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [showConfirmCancel, setShowConfirmCancel] = useState<number | null>(null);

  useEffect(() => {
    loadAppointments();
  }, [selectedDate]);

  const loadAppointments = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/salon/appointments?date=${selectedDate}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments);
      }
    } catch (error) {
      console.error('Error loading appointments:', error);
    } finally {
      setLoading(false);
    }
  };

  const cancelAppointment = async (appointmentId: number) => {
    setCancelling(appointmentId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/salon/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (response.ok) {
        setSuccess('Randevu başarıyla iptal edildi');
        loadAppointments(); // Reload appointments
        setShowConfirmCancel(null);
      } else {
        const errorData = await response.json();
        setError(`İptal edilemedi: ${errorData.message}`);
      }
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      setError('Randevu iptal edilemedi - bağlantı hatası');
    } finally {
      setCancelling(null);
    }
  };

  const generateRescheduleLink = async (appointmentId: number) => {
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/salon/appointments/${appointmentId}/reschedule-link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Copy to clipboard
        await navigator.clipboard.writeText(data.magicUrl);
        setSuccess(`Erteleme bağlantısı panoya kopyalandı`);
      } else {
        const errorData = await response.json();
        setError(`Erteleme bağlantısı oluşturulamadı: ${errorData.message}`);
      }
    } catch (error) {
      console.error('Error generating reschedule link:', error);
      setError('Erteleme bağlantısı oluşturulamadı - bağlantı hatası');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'BOOKED': return 'bg-green-100 text-green-800';
      case 'CANCELLED': return 'bg-red-100 text-red-800';
      case 'COMPLETED': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'BOOKED': return 'Onaylandı';
      case 'CANCELLED': return 'İptal Edildi';
      case 'COMPLETED': return 'Tamamlandı';
      default: return status;
    }
  };

  const formatDateTime = (dateTime: string) => {
    return new Date(dateTime).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
          <h1 className="text-2xl font-bold text-gray-900">Randevular</h1>
          <p className="mt-1 text-sm text-gray-600">
            Salonunuzun randevularını görüntüleyin
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800 text-sm">{error}</div>
          </div>
        )}

        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 rounded-md p-4">
            <div className="text-green-800 text-sm">{success}</div>
          </div>
        )}

        {/* Cancel Confirmation Dialog */}
        {showConfirmCancel && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-md p-4">
            <div className="text-yellow-800 text-sm mb-3">
              Bu randevuyu iptal etmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => cancelAppointment(showConfirmCancel)}
                className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700"
              >
                Evet, İptal Et
              </button>
              <button
                onClick={() => setShowConfirmCancel(null)}
                className="bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}

        {/* Date Filter */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tarih Seçin
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Appointments List */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          {appointments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Bu tarihte randevu bulunmuyor.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {appointments.map(appointment => (
                <li key={appointment.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <div className="flex-1">
                          <h3 className="text-sm font-medium text-gray-900">
                            {appointment.customer.name}
                          </h3>
                          <p className="text-sm text-gray-600">
                            {appointment.customer.phone}
                          </p>
                        </div>
                        <div className="flex-1 ml-4">
                          <p className="text-sm text-gray-900">
                            {appointment.services[0].name}
                          </p>
                          <p className="text-sm text-gray-600">
                            {formatDateTime(appointment.datetime)}
                          </p>
                        </div>
                        <div className="flex-1 ml-4">
                          <p className="text-sm text-gray-600">
                            ₺{appointment.services[0].price || 0}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                        {getStatusText(appointment.status)}
                      </span>
                      {appointment.status === 'CONFIRMED' && (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => setShowConfirmCancel(appointment.id)}
                            disabled={cancelling === appointment.id}
                            className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700 disabled:bg-gray-400"
                          >
                            {cancelling === appointment.id ? 'İptal Ediliyor...' : 'İptal Et'}
                          </button>
                          <button
                            onClick={() => generateRescheduleLink(appointment.id)}
                            className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700"
                          >
                            Ertele
                          </button>
                        </div>
                      )}
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

export default SalonAppointments;