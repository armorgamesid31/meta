import React from 'react';

interface BookingLayoutProps {
  children: React.ReactNode;
}

export function BookingLayout({ children }: BookingLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Salon Asistan</h1>
          <p className="text-slate-500">Online Randevu Sistemi</p>
        </header>
        <main>
          {children}
        </main>
      </div>
      {/* Toaster component if needed later, but for now simple */}
    </div>
  );
}
