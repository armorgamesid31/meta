import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { AdminSummary } from '../types/admin';
import { Appointment } from '../types/appointment';
import { Client } from '../types/client';
import { API_BASE_URL } from '../config';

const AdminLayout: React.FC = () => {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState<string | null>(null);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAppointment, setNewAppointment] = useState({
    clientId: '',
    date: '',
    time: ''
  });
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const { data } = await apiFetch<AdminSummary>(`${API_BASE_URL}/api/admin/summary`);
        setSummary(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load admin data');
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  useEffect(() => {
    if (!summary) return;

    const fetchAppointments = async () => {
      setAppointmentsLoading(true);
      setAppointmentsError(null);
      try {
        const { data } = await apiFetch<Appointment[]>(`${API_BASE_URL}/api/admin/appointments`);
        setAppointments(data);
      } catch (err: any) {
        setAppointmentsError(err.message || 'Failed to load appointments');
      } finally {
        setAppointmentsLoading(false);
      }
    };

    fetchAppointments();
  }, [summary]);

  useEffect(() => {
    if (!summary) return;

    const fetchClients = async () => {
      setClientsLoading(true);
      setClientsError(null);
      try {
        const { data } = await apiFetch<Client[]>(`${API_BASE_URL}/api/admin/clients`);
        setClients(data);
      } catch (err: any) {
        setClientsError(err.message || 'Failed to load clients');
      } finally {
        setClientsLoading(false);
      }
    };

    fetchClients();
  }, [summary]);

  const createAppointment = async () => {
    if (!newAppointment.clientId || !newAppointment.date || !newAppointment.time) {
      setCreateError('All fields are required');
      return;
    }

    setCreateError(null);
    setCreatingAppointment(true);

    // Find client name for optimistic update
    const client = clients.find(c => c.id === newAppointment.clientId);
    if (!client) {
      setCreateError('Client not found');
      setCreatingAppointment(false);
      return;
    }

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticAppointment: Appointment = {
      id: tempId,
      clientName: client.name,
      service: 'New Appointment', // Default service
      date: newAppointment.date,
      time: newAppointment.time,
      status: 'pending'
    };

    setAppointments(prev => [...prev, optimisticAppointment]);

    try {
      const { data } = await apiFetch<Appointment>(`${API_BASE_URL}/api/admin/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: newAppointment.clientId,
          date: newAppointment.date,
          time: newAppointment.time
        })
      });

      // Replace optimistic item with real data
      setAppointments(prev => prev.map(apt =>
        apt.id === tempId ? data : apt
      ));

      // Reset form
      setNewAppointment({ clientId: '', date: '', time: '' });
      setShowAddForm(false);
    } catch (err: any) {
      // Rollback optimistic update
      setAppointments(prev => prev.filter(apt => apt.id !== tempId));
      setCreateError(err.message || 'Failed to create appointment');
    } finally {
      setCreatingAppointment(false);
    }
  };

  if (loading) {
    return <div>Loading admin data...</div>;
  }

  if (error) {
    return <div>Failed to load admin data</div>;
  }

  if (!summary) {
    return <div>No data available</div>;
  }

  return (
    <div>
      <h1>Admin Dashboard</h1>
      <div>
        <p>Total Appointments: {summary.totalAppointments}</p>
        <p>Total Revenue: ${summary.totalRevenue}</p>
        <p>Active Clients: {summary.activeClients}</p>
        <p>Upcoming Appointments: {summary.upcomingAppointments}</p>
      </div>

      <h2>Upcoming Appointments</h2>
      {appointmentsLoading && <div>Loading appointments...</div>}
      {appointmentsError && <div>Failed to load appointments</div>}
      {!appointmentsLoading && !appointmentsError && appointments.length === 0 && (
        <div>No appointments yet</div>
      )}
      {!appointmentsLoading && !appointmentsError && appointments.length > 0 && (
        <ul>
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              {appointment.clientName} - {appointment.service} at {appointment.time} on {appointment.date} ({appointment.status})
            </li>
          ))}
        </ul>
      )}

      {!appointmentsLoading && !appointmentsError && (
        <div>
          <button onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : 'Add Appointment'}
          </button>
          {showAddForm && (
            <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #ccc' }}>
              <h3>Add New Appointment</h3>
              <div>
                <label>
                  Client:
                  <select
                    value={newAppointment.clientId}
                    onChange={(e) => setNewAppointment(prev => ({ ...prev, clientId: e.target.value }))}
                  >
                    <option value="">Select a client</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <label>
                  Date:
                  <input
                    type="date"
                    value={newAppointment.date}
                    onChange={(e) => setNewAppointment(prev => ({ ...prev, date: e.target.value }))}
                  />
                </label>
              </div>
              <div>
                <label>
                  Time:
                  <input
                    type="time"
                    value={newAppointment.time}
                    onChange={(e) => setNewAppointment(prev => ({ ...prev, time: e.target.value }))}
                  />
                </label>
              </div>
              <button onClick={createAppointment} disabled={creatingAppointment}>
                {creatingAppointment ? 'Creating...' : 'Create Appointment'}
              </button>
              {createError && <p style={{ color: 'red' }}>{createError}</p>}
            </div>
          )}
        </div>
      )}

      <h2>Clients</h2>
      {clientsLoading && <div>Loading clients...</div>}
      {clientsError && <div>Failed to load clients</div>}
      {!clientsLoading && !clientsError && clients.length === 0 && (
        <div>No clients yet</div>
      )}
      {!clientsLoading && !clientsError && clients.length > 0 && (
        <ul>
          {clients.map((client) => (
            <li key={client.id}>
              {client.name} - {client.phone} ({client.totalAppointments} appointments, last visit: {client.lastVisit})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminLayout;
