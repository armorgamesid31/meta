import { User, Phone, Calendar } from 'lucide-react';
import { useState } from 'react';

interface BookingInfoFormProps {
  name?: string;
  phone?: string;
  birthDate?: string;
  gender?: 'woman' | 'man';
  onNameChange?: (name: string) => void;
  onPhoneChange?: (phone: string) => void;
  onBirthDateChange?: (date: string) => void;
  onGenderChange?: (gender: 'woman' | 'man') => void;
  primaryColor?: string;
  accentColor?: string;
  borderRadius?: string;
}

export function BookingInfoForm({
  name = '',
  phone = '',
  birthDate = '',
  gender = 'woman',
  onNameChange,
  onPhoneChange,
  onBirthDateChange,
  onGenderChange,
  primaryColor = '#BC952B',
  accentColor = '#10B981',
  borderRadius = '24px',
}: BookingInfoFormProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handlePhoneChange = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const formatted = cleaned
      .slice(0, 10)
      .replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, '($1) $2 $3 $4');
    onPhoneChange?.(formatted);
  };

  return (
    <div
      className="bg-white shadow-sm border border-gray-100 p-5 space-y-5"
      style={{ borderRadius }}
    >
      <h3 className="font-bold text-[#1a1a1a] text-[15px]">Randevu Bilgileri</h3>

      {/* Name Field */}
      <div>
        <label className="text-[12px] font-bold text-[#6b7280] block mb-2.5">
          <User className="w-4 h-4 inline mr-1.5" />
          Ad Soyad
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange?.(e.target.value)}
          placeholder="Ayşe Yılmaz"
          className="w-full h-[48px] px-4 rounded-[16px] border border-gray-200 focus:border-gray-300 focus:outline-none transition-colors text-[14px] font-medium placeholder-gray-400 bg-white"
          style={{
            borderColor: errors.name ? '#EF4444' : undefined,
          }}
        />
        {errors.name && (
          <p className="text-[11px] text-[#EF4444] mt-1.5 font-bold">
            {errors.name}
          </p>
        )}
      </div>

      {/* Phone Field */}
      <div>
        <label className="text-[12px] font-bold text-[#6b7280] block mb-2.5">
          <Phone className="w-4 h-4 inline mr-1.5" />
          Telefon
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => handlePhoneChange(e.target.value)}
          placeholder="(555) 123 45 67"
          className="w-full h-[48px] px-4 rounded-[16px] border border-gray-200 focus:border-gray-300 focus:outline-none transition-colors text-[14px] font-medium placeholder-gray-400 bg-white"
          style={{
            borderColor: errors.phone ? '#EF4444' : undefined,
          }}
        />
        {errors.phone && (
          <p className="text-[11px] text-[#EF4444] mt-1.5 font-bold">
            {errors.phone}
          </p>
        )}
      </div>

      {/* Birth Date Field */}
      <div>
        <label className="text-[12px] font-bold text-[#6b7280] block mb-2.5">
          <Calendar className="w-4 h-4 inline mr-1.5" />
          Doğum Tarihi
        </label>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => onBirthDateChange?.(e.target.value)}
          className="w-full h-[48px] px-4 rounded-[16px] border border-gray-200 focus:border-gray-300 focus:outline-none transition-colors text-[14px] font-medium bg-white"
          style={{
            borderColor: errors.birthDate ? '#EF4444' : undefined,
          }}
        />
        {errors.birthDate && (
          <p className="text-[11px] text-[#EF4444] mt-1.5 font-bold">
            {errors.birthDate}
          </p>
        )}
      </div>

      {/* Gender Selection */}
      <div>
        <label className="text-[12px] font-bold text-[#6b7280] block mb-2.5">
          Cinsiyet
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onGenderChange?.('woman')}
            className={`h-[48px] rounded-[16px] font-bold text-[14px] transition-all cursor-pointer border ${
              gender === 'woman'
                ? 'border-transparent text-white shadow-md'
                : 'border-gray-200 text-[#4b5563] hover:border-gray-300'
            }`}
            style={{
              backgroundColor: gender === 'woman' ? primaryColor : '#f9fafb',
            }}
          >
            Kadın
          </button>
          <button
            onClick={() => onGenderChange?.('man')}
            className={`h-[48px] rounded-[16px] font-bold text-[14px] transition-all cursor-pointer border ${
              gender === 'man'
                ? 'border-transparent text-white shadow-md'
                : 'border-gray-200 text-[#4b5563] hover:border-gray-300'
            }`}
            style={{
              backgroundColor: gender === 'man' ? primaryColor : '#f9fafb',
            }}
          >
            Erkek
          </button>
        </div>
      </div>

      {/* Privacy Checkbox */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          defaultChecked
          className="w-5 h-5 mt-0.5 rounded-lg border-2 border-gray-300 accent-green-500 cursor-pointer"
        />
        <span className="text-[12px] text-[#6b7280] leading-snug">
          Kampanyalar ve özel fırsatlardan haberdar olmak istiyorum
        </span>
      </label>
    </div>
  );
}
