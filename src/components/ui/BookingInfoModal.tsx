import { useState } from 'react';
import { X } from 'lucide-react';
import { BookingInfoForm } from './BookingInfoForm';

interface BookingInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; phone: string; birthDate: string }) => void;
  initialData?: {
    name?: string;
    phone?: string;
    birthDate?: string;
  };
}

export function BookingInfoModal({
  isOpen,
  onClose,
  onSubmit,
  initialData = {},
}: BookingInfoModalProps) {
  const [name, setName] = useState(initialData.name || '');
  const [phone, setPhone] = useState(initialData.phone || '');
  const [birthDate, setBirthDate] = useState(initialData.birthDate || '');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (name.trim() && phone.trim() && birthDate.trim()) {
      onSubmit({ name, phone, birthDate });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Background Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative bg-white rounded-[24px] shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-[#1a1a1a] text-[16px]">
            Randevu Bilgileri
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <BookingInfoForm
            name={name}
            phone={phone}
            birthDate={birthDate}
            onNameChange={setName}
            onPhoneChange={setPhone}
            onBirthDateChange={setBirthDate}
          />
        </div>

        {/* Footer with Action Button */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-[48px] rounded-[16px] font-bold text-[15px] border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-all cursor-pointer"
          >
            İptal
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !phone.trim() || !birthDate.trim()}
            className={`flex-1 h-[48px] rounded-[16px] font-bold text-[15px] transition-all cursor-pointer shadow-md ${
              name.trim() && phone.trim() && birthDate.trim()
                ? 'bg-[#BC952B] text-white hover:bg-[#A68325]'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Devam Et
          </button>
        </div>
      </div>
    </div>
  );
}
