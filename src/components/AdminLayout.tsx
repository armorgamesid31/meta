import React from 'react';
import { Outlet, Link } from 'react-router-dom';

const AdminLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header style={{ padding: '1rem', borderBottom: '1px solid #ccc', textAlign: 'center' }}>
        <h1>SalonAsistan Admin</h1>
      </header>

      <main style={{ flexGrow: 1, padding: '1rem' }}>
        {children || <Outlet />}
      </main>

      <nav style={{
        display: 'flex',
        justifyContent: 'space-around',
        padding: '0.5rem 0',
        borderTop: '1px solid #ccc',
        position: 'fixed',
        bottom: 0,
        width: '100%',
        backgroundColor: '#f8f8f8',
        boxShadow: '0 -2px 5px rgba(0,0,0,0.1)'
      }}>
        <Link to="/admin/dashboard">Dashboard</Link>
        <Link to="/admin/calendar">Calendar</Link>
        <Link to="/admin/settings">Settings</Link>
      </nav>
    </div>
  );
};

export default AdminLayout;
