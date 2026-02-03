import React from 'react';
import { Loader2 } from 'lucide-react';

export interface PrimaryActionButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'default' | 'secondary' | 'outline';
  className?: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const PrimaryActionButton: React.FC<PrimaryActionButtonProps> = ({
  label,
  onClick,
  disabled = false,
  loading = false,
  variant = 'default',
  className = '',
  fullWidth = true,
  size = 'lg',
}) => {
  const baseStyles =
    'font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg';

  const sizeStyles = {
    sm: 'py-2 px-4 text-sm',
    md: 'py-3 px-6 text-base',
    lg: 'py-4 px-6 text-base',
  };

  const variantStyles = {
    default: 'bg-amber-600 text-white hover:bg-amber-700 active:bg-amber-800 shadow-md',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 active:bg-gray-400',
    outline: 'border-2 border-amber-600 text-amber-600 hover:bg-amber-50 active:bg-amber-100',
  };

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${widthClass} ${className} flex items-center justify-center gap-2`}
      aria-busy={loading}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      <span>{label}</span>
    </button>
  );
};
