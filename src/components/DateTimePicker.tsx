import { useState } from 'react';
import { Calendar, Clock, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DateTimePickerProps {
  selectedDate?: string;
  selectedTime?: string;
  onDateSelect: (date: string) => void;
  onTimeSelect: (time: string) => void;
  totalDuration: number;
  salonId?: string;
}

const dates = [
  { day: 'Pzt', date: '12', fullDate: '2026-01-12', available: true },
  { day: 'Sal', date: '13', fullDate: '2026-01-13', available: true },
  { day: 'Çar', date: '14', fullDate: '2026-01-14', available: false },
  { day: 'Per', date: '15', fullDate: '2026-01-15', available: true },
  { day: 'Cum', date: '16', fullDate: '2026-01-16', available: true },
  { day: 'Cmt', date: '17', fullDate: '2026-01-17', available: true },
  { day: 'Paz', date: '18', fullDate: '2026-01-18', available: false },
];

const timeSlots = {
  morning: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'],
  afternoon: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00'],
  evening: ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00'],
};

function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

export function DateTimePicker({
  selectedDate,
  selectedTime,
  onDateSelect,
  onTimeSelect,
  totalDuration,
}: DateTimePickerProps) {
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);

  const handleDateClick = (date: typeof dates[0]) => {
    if (!date.available) {
      setShowWaitlist(true);
      setWaitlistSubmitted(false);
    } else {
      setShowWaitlist(false);
      setWaitlistSubmitted(false);
      onDateSelect(date.fullDate);
    }
  };

  const handleWaitlistSubmit = () => {
    setWaitlistSubmitted(true);
    // Mock waitlist submission
    console.log('Waitlist submitted for date');
  };

  return (
    <div className="space-y-4">
      {/* Date Selection */}
      <div className="bg-white rounded-[20px] p-6 shadow-premium border border-gray-100 card-premium">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-[#D4AF37]" />
          <h3 className="text-lg font-semibold text-[#2D2D2D] text-premium">Tarih Seçin</h3>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {dates.map((date) => (
            <button
              key={date.fullDate}
              onClick={() => handleDateClick(date)}
              className={`flex-shrink-0 w-16 px-3 py-4 rounded-[15px] text-center transition-all ${
                selectedDate === date.fullDate
                  ? 'bg-[#D4AF37] text-white shadow-md'
                  : date.available
                  ? 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                  : 'bg-gray-100 text-gray-400 cursor-pointer'
              }`}
            >
              <div className="text-xs mb-2">{date.day}</div>
              <div className="text-lg font-semibold">{date.date}</div>
              {!date.available && <div className="text-xs mt-1">Dolu</div>}
            </button>
          ))}
        </div>

        {/* Waitlist Option */}
        <AnimatePresence>
          {showWaitlist && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              {!waitlistSubmitted ? (
                <div className="mt-4 bg-gradient-to-r from-[#2D2D2D] to-[#3D3D3D] rounded-[15px] p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <UserPlus className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-white mb-1">
                        Bu Gün İçin Bekleme Listesine Girin
                      </h4>
                      <p className="text-sm text-gray-300">
                        Bir yer açılırsa size WhatsApp'tan haber verelim
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleWaitlistSubmit}
                    className="w-full bg-white text-[#2D2D2D] rounded-[12px] px-4 py-3 font-semibold hover:bg-gray-100 transition-colors"
                  >
                    Sıraya Gir
                  </button>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-4 bg-[#10B981]/10 border border-[#10B981]/30 rounded-[15px] p-4"
                >
                  <p className="text-[#10B981] font-medium text-center">
                    ✓ Bekleme listesine eklendiniz! Bir yer açılırsa sizi haberdar edeceğiz.
                  </p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div className="bg-white rounded-[20px] p-6 shadow-premium border border-gray-100 card-premium">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#D4AF37]" />
              <h3 className="text-lg font-semibold text-[#2D2D2D] text-premium">Saat Seçin</h3>
            </div>
            {totalDuration > 0 && (
              <span className="text-sm text-gray-500 text-premium">
                ~{totalDuration} dakika
              </span>
            )}
          </div>

          <div className="space-y-6">
            {/* Morning */}
            <div>
              <p className="text-sm font-medium text-gray-600 mb-3">Sabah</p>
              <div className="grid grid-cols-3 gap-3">
                {timeSlots.morning.map((time) => {
                  const endTime = totalDuration > 0 ? calculateEndTime(time, totalDuration) : null;
                  const isSelected = selectedTime === time;

                  return (
                    <button
                      key={time}
                      onClick={() => onTimeSelect(time)}
                      className={`py-4 px-3 rounded-[12px] text-sm font-medium transition-all ${
                        isSelected
                          ? 'bg-[#D4AF37] text-white shadow-md'
                          : 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                      }`}
                    >
                      <div>{time}</div>
                      {isSelected && endTime && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-xs mt-1 text-white/80"
                        >
                          - {endTime}
                        </motion.div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Afternoon */}
            <div>
              <p className="text-sm font-medium text-gray-600 mb-3">Öğle</p>
              <div className="grid grid-cols-3 gap-3">
                {timeSlots.afternoon.map((time) => {
                  const endTime = totalDuration > 0 ? calculateEndTime(time, totalDuration) : null;
                  const isSelected = selectedTime === time;

                  return (
                    <button
                      key={time}
                      onClick={() => onTimeSelect(time)}
                      className={`py-4 px-3 rounded-[12px] text-sm font-medium transition-all ${
                        isSelected
                          ? 'bg-[#D4AF37] text-white shadow-md'
                          : 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                      }`}
                    >
                      <div>{time}</div>
                      {isSelected && endTime && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-xs mt-1 text-white/80"
                        >
                          - {endTime}
                        </motion.div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Evening */}
            <div>
              <p className="text-sm font-medium text-gray-600 mb-3">Akşam</p>
              <div className="grid grid-cols-3 gap-3">
                {timeSlots.evening.map((time) => {
                  const endTime = totalDuration > 0 ? calculateEndTime(time, totalDuration) : null;
                  const isSelected = selectedTime === time;

                  return (
                    <button
                      key={time}
                      onClick={() => onTimeSelect(time)}
                      className={`py-4 px-3 rounded-[12px] text-sm font-medium transition-all ${
                        isSelected
                          ? 'bg-[#D4AF37] text-white shadow-md'
                          : 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                      }`}
                    >
                      <div>{time}</div>
                      {isSelected && endTime && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-xs mt-1 text-white/80"
                        >
                          - {endTime}
                        </motion.div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
