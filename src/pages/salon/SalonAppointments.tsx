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
    if (!confirm('Bu randevuyu iptal etmek istediğinizden emin misiniz?')) {
      return;
    }

    try {
      const response = await fetch(`/api/salon/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('salonToken')}`
        }
      });

      if (response.ok) {
        alert('Randevu iptal edildi');
        loadAppointments(); // Reload appointments
      } else {
        const error = await response.json();
        alert(`Hata: ${error.message}`);
      }
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      alert('Randevu iptal edilemedi');
    }
  };

  const generateRescheduleLink = async (appointmentId: number) => {
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
        navigator.clipboard.writeText(data.magicUrl);
        alert(`Erteleme bağlantısı kopyalandı: ${data.magicUrl}`);
      } else {
        const error = await response.json();
        alert(`Hata: ${error.message}`);
      }
    } catch (error) {
      console.error('Error generating reschedule link:', error);
      alert('Erteleme bağlantısı oluşturulamadı');
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
                            onClick={() => cancelAppointment(appointment.id)}
                            className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
                          >
                            İptal Et
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