import React from 'react';

interface BookingLayoutProps {
  children: React.ReactNode;
}

export function BookingLayout1({ children }: BookingLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex justify-center py-0 sm:py-8">
      <div className="w-full max-w-md bg-white sm:rounded-[24px] sm:shadow-xl sm:border sm:border-slate-100 min-h-screen sm:min-h-0 flex flex-col">
        <main className="flex-1 flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
