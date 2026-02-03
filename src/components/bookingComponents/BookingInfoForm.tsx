import React from 'react';

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
  nameLabel?: string;
  phoneLabel?: string;
  genderLabel?: string;
  birthDateLabel?: string;
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
  nameLabel = 'Ad Soyad',
  phoneLabel = 'Telefon',
  genderLabel = 'Cinsiyet',
  birthDateLabel = 'Doğum Tarihi',
}) => {
  const handleChange = (field: keyof FormData, value: string) => {
    const newData = { ...data, [field]: value };
    onChange?.(newData);
  };

  return (
    <div className="w-full space-y-4">
      {/* Name Field */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {nameLabel}
        </label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="Adınız Soyadınız"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent"
        />
      </div>

      {/* Phone Field */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {phoneLabel}
        </label>
        <input
          type="tel"
          value={data.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          placeholder="0555 123 45 67"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent"
        />
      </div>

      {/* Gender Field */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {genderLabel}
        </label>
        <div className="flex gap-2">
          {['female', 'male', 'other'].map((option) => (
            <button
              key={option}
              onClick={() =>
                handleChange('gender', option as 'male' | 'female' | 'other')
              }
              className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
                data.gender === option
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {option === 'female' && 'Kadın'}
              {option === 'male' && 'Erkek'}
              {option === 'other' && 'Diğer'}
            </button>
          ))}
        </div>
      </div>

      {/* Birth Date Field */}
      {showBirthDate && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            {birthDateLabel}
          </label>
          <input
            type="date"
            value={data.birthDate || ''}
            onChange={(e) => handleChange('birthDate', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent"
          />
        </div>
      )}
    </div>
  );
};
