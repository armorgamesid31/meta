import { useState, useEffect } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface DateTimePickerProps {
  selectedDate?: string;
  selectedTime?: string;
  onDateSelect: (date: string) => void;
  onTimeSelect: (time: string) => void;
  totalDuration: number;
  salonId?: string;
}

interface TimeSlot {
  time: string;
  available: boolean;
}

export function DateTimePicker({
  selectedDate,
  selectedTime,
  onDateSelect,
  onTimeSelect,
  totalDuration,
  salonId
}: DateTimePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'date' | 'time'>('date');

  // Generate next 14 days
  const generateDates = () => {
    const dates = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const dates = generateDates();

  // Fetch availability when date changes
  useEffect(() => {
    if (selectedDate && salonId) {
      fetchTimeSlots(selectedDate);
    }
  }, [selectedDate, salonId]);

  const fetchTimeSlots = async (date: string) => {
    if (!salonId) return;

    try {
      setLoading(true);
      // For now, generate mock time slots - in real implementation, call availability API
      const slots: TimeSlot[] = [];
      const startHour = 9;
      const endHour = 18;
      const interval = 30; // minutes

      for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += interval) {
          const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          // Mock availability - in real app, check against booked slots
          const available = Math.random() > 0.3; // 70% available
          slots.push({ time: timeString, available });
        }
      }

      setTimeSlots(slots);
    } catch (error) {
      console.error('Error fetching time slots:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const formatDisplayDate = (date: Date) => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    };
    return date.toLocaleDateString('tr-TR', options);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSelectedDate = (date: Date) => {
    return selectedDate === formatDate(date);
  };

  const handleDateClick = (date: Date) => {
    const dateString = formatDate(date);
    onDateSelect(dateString);
    setView('time');
  };

  const handleTimeClick = (time: string) => {
    onTimeSelect(time);
  };

  const formatTime = (time: string) => {
    const [hour, minute] = time.split(':');
    const hourNum = parseInt(hour);
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
    return `${displayHour}:${minute} ${ampm}`;
  };

  if (view === 'date') {
    return (
      <div className="bg-white rounded-[20px] p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[#2D2D2D]">Tarih Seçin</h3>
          <Calendar className="w-5 h-5 text-[#D4AF37]" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {dates.map((date) => (
            <button
              key={formatDate(date)}
              onClick={() => handleDateClick(date)}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                isSelectedDate(date)
                  ? 'border-[#D4AF37] bg-[#D4AF37]/5'
                  : 'border-gray-200 hover:border-[#D4AF37]/50'
              }`}
            >
              <div className="text-sm font-medium text-[#2D2D2D]">
                {isToday(date) ? 'Bugün' : date.toLocaleDateString('tr-TR', { weekday: 'short' })}
              </div>
              <div className={`text-lg font-bold ${isSelectedDate(date) ? 'text-[#D4AF37]' : 'text-[#2D2D2D]'}`}>
                {date.getDate()}
              </div>
              <div className="text-xs text-gray-500">
                {date.toLocaleDateString('tr-TR', { month: 'short' })}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[20px] p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setView('date')}
          className="flex items-center gap-2 text-[#D4AF37] hover:text-[#B8941F] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Tarih Değiştir</span>
        </button>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-[#2D2D2D]">Saat Seçin</h3>
          <p className="text-sm text-gray-600">
            {selectedDate && formatDisplayDate(new Date(selectedDate))}
          </p>
        </div>
        <div className="w-20"></div> {/* Spacer */}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
          <span className="ml-2 text-gray-600">Saatler yükleniyor...</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 max-h-60 overflow-y-auto">
          {timeSlots.map((slot) => (
            <button
              key={slot.time}
              onClick={() => slot.available && handleTimeClick(slot.time)}
              disabled={!slot.available}
              className={`p-3 rounded-lg border transition-all ${
                selectedTime === slot.time
                  ? 'border-[#D4AF37] bg-[#D4AF37]/10 text-[#D4AF37]'
                  : slot.available
                  ? 'border-gray-200 hover:border-[#D4AF37]/50 text-[#2D2D2D]'
                  : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
              }`}
            >
              <div className="text-sm font-medium">
                {formatTime(slot.time)}
              </div>
              {!slot.available && (
                <div className="text-xs text-gray-400 mt-1">Dolu</div>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center gap-2 text-blue-800">
          <Clock className="w-4 h-4" />
          <span className="text-sm font-medium">Tahmini Süre: {totalDuration} dakika</span>
        </div>
      </div>
    </div>
  );
}