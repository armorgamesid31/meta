import { ReactNode } from 'react';

interface PrimaryActionButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'default' | 'outline';
  isLoading?: boolean;
  className?: string;
}

export function PrimaryActionButton({
  children,
  onClick,
  disabled = false,
  size = 'medium',
  variant = 'default',
  isLoading = false,
  className = '',
}: PrimaryActionButtonProps) {
  const sizeStyles = {
    small: 'h-[40px] text-sm px-4',
    medium: 'h-[48px] text-base px-6',
    large: 'h-[56px] text-lg px-8',
  };

  const variantStyles = {
    default: `bg-[#BC952B] text-white border border-[#BC952B] hover:bg-[#A68325] active:scale-[0.97] shadow-md ${
      disabled ? 'opacity-50 cursor-not-allowed' : ''
    }`,
    outline: `bg-white text-[#BC952B] border-2 border-[#BC952B] hover:bg-[#FFF9E5] active:scale-[0.97] shadow-sm ${
      disabled ? 'opacity-50 cursor-not-allowed' : ''
    }`,
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`rounded-[16px] font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
    >
      {isLoading ? (
        <>
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Yükleniyor...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
