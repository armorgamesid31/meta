import React from 'react';
import { User, Phone, Calendar } from 'lucide-react';

export interface FormData {
  name: string;
  phone: string;
  gender: 'male' | 'female' | 'other';
  birthDate?: string;
}

export interface BookingInfoFormProps {
  data?: FormData;
  onChange?: (data: FormData) => void;
  showBirthDate?: boolean;
  showOptionalCheckbox?: boolean;
  nameLabel?: string;
  phoneLabel?: string;
  genderLabel?: string;
  birthDateLabel?: string;
  checkboxLabel?: string;
  isLocked?: boolean;
}

export const BookingInfoForm: React.FC<BookingInfoFormProps> = ({
  data = {
    name: '',
    phone: '',
    gender: 'female',
    birthDate: '',
  },
  onChange,
  showBirthDate = true,
  showOptionalCheckbox = true,
  nameLabel = 'Ad Soyad',
  phoneLabel = 'Telefon',
  genderLabel = 'Cinsiyet',
  birthDateLabel = 'Doğum Tarihi',
  checkboxLabel = 'Kampanyalar ve özel fırsatlardan haberdar olmak istiyorum',
  isLocked = false,
}) => {
  const handleChange = (field: keyof FormData, value: string) => {
    const newData = { ...data, [field]: value };
    onChange?.(newData);
  };

  const renderFieldWithLock = (children: React.ReactNode, locked?: boolean) => {
    return (
      <div className="relative">
        {children}
        {locked && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            🔒
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full space-y-5">
      {/* Name Field */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <User className="w-4 h-4 text-gray-600" />
          {nameLabel}
        </label>
        {renderFieldWithLock(
          <input
            type="text"
            value={data.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="Adınız Soyadınız"
            disabled={isLocked}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 pr-10"
          />,
          isLocked
        )}
      </div>

      {/* Phone Field */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <Phone className="w-4 h-4 text-gray-600" />
          {phoneLabel}
        </label>
        {renderFieldWithLock(
          <input
            type="tel"
            value={data.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="0555 123 45 67"
            disabled={isLocked}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 pr-10"
          />,
          isLocked
        )}
      </div>

      {/* Gender Field */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {genderLabel}
        </label>
        <div className="flex gap-2">
          {[
            { value: 'female', label: 'Kadın' },
            { value: 'male', label: 'Erkek' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() =>
                handleChange('gender', option.value as 'male' | 'female' | 'other')
              }
              disabled={isLocked}
              className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 ${
                data.gender === option.value
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Birth Date Field */}
      {showBirthDate && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-600" />
            {birthDateLabel}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={data.birthDate || ''}
            onChange={(e) => handleChange('birthDate', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent"
          />
        </div>
      )}

      {/* Optional Checkbox */}
      {showOptionalCheckbox && (
        <div className="pt-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 w-4 h-4 rounded border-gray-300 accent-amber-600"
              defaultChecked={false}
            />
            <span className="text-sm text-gray-700">{checkboxLabel}</span>
          </label>
        </div>
      )}
    </div>
  );
};
