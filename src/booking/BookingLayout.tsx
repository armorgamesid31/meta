import React from 'react';

interface BookingLayoutProps {
  children: React.ReactNode;
}

export function BookingLayout({ children }: BookingLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-4 px-4 sm:py-8">
      <div className="w-full max-w-md">
        <main>
          {children}
        </main>
      </div>
    </div>
  );
}
