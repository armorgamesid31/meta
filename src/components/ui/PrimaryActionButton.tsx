import { ReactNode } from 'react';

interface PrimaryActionButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'solid' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  primaryColor?: string;
  buttonVariant?: 'rounded' | 'pill';
  className?: string;
}

export function PrimaryActionButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  variant = 'solid',
  size = 'lg',
  fullWidth = false,
  primaryColor = '#BC952B',
  buttonVariant = 'rounded',
  className = '',
}: PrimaryActionButtonProps) {
  const sizeClasses = {
    sm: 'h-10 px-4 text-xs',
    md: 'h-12 px-6 text-sm',
    lg: 'h-14 px-8 text-base',
  };

  const borderRadius = buttonVariant === 'pill' ? '9999px' : '18px';

  const baseClasses = `
    font-bold transition-all cursor-pointer flex items-center justify-center gap-2 
    active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed
    ${fullWidth ? 'w-full' : ''}
    ${sizeClasses[size]}
    ${className}
  `;

  if (variant === 'solid') {
    return (
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className={baseClasses}
        style={{
          backgroundColor: disabled ? '#d1d5db' : primaryColor,
          color: 'white',
          borderRadius,
          boxShadow: disabled ? 'none' : '0 4px 12px rgba(0, 0, 0, 0.1)',
        }}
      >
        {loading && (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        )}
        {children}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={baseClasses}
      style={{
        backgroundColor: 'transparent',
        color: primaryColor,
        border: `2px solid ${primaryColor}`,
        borderRadius,
      }}
    >
      {loading && (
        <div
          className="w-4 h-4 border-2 rounded-full animate-spin"
          style={{
            borderColor: `${primaryColor}40`,
            borderTopColor: primaryColor,
          }}
        />
      )}
      {children}
    </button>
  );
}
