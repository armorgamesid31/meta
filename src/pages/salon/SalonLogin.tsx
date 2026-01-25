import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../../utils/api';

const SalonLogin: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [salonName, setSalonName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        // Login
        const response = await apiPost('/auth/login', { email, password });
        const data = await response.json();

        if (response.ok) {
          // Store token and user info
          localStorage.setItem('salonToken', data.token);
          localStorage.setItem('salonUser', JSON.stringify(data.user));

          // Redirect to dashboard
          navigate('/salon/dashboard');
        } else {
          setError(data.message || 'Giriş başarısız');
        }
      } else {
        // Registration
        const response = await apiPost('/auth/register-salon', {
          email,
          password,
          salonName
        });
        const data = await response.json();

        if (response.ok) {
          // Auto-login after registration
          localStorage.setItem('salonToken', data.token);
          localStorage.setItem('salonUser', JSON.stringify(data.user));

          // Redirect to dashboard (will trigger onboarding)
          navigate('/salon/dashboard');
        } else {
          setError(data.message || 'Kayıt başarısız');
        }
      }
    } catch (error) {
      setError('Bağlantı hatası. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {isLogin ? 'Salon Panel Girişi' : 'Yeni Salon Oluştur'}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {isLogin ? 'Salonunuzu yönetmek için giriş yapın' : 'İlk kez mi? Yeni salonunuzu oluşturun'}
          </p>
        </div>

        {/* Login/Register Toggle */}
        <div className="flex justify-center">
          <div className="bg-gray-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={`px-4 py-2 text-sm font-medium rounded-md ${
                isLogin ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Giriş Yap
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={`px-4 py-2 text-sm font-medium rounded-md ${
                !isLogin ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Yeni Salon
            </button>
          </div>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            {!isLogin && (
              <div>
                <label htmlFor="salonName" className="sr-only">
                  Salon Adı
                </label>
                <input
                  id="salonName"
                  name="salonName"
                  type="text"
                  required={!isLogin}
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="Salon adı"
                  value={salonName}
                  onChange={(e) => setSalonName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="sr-only">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className={`appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 ${
                  isLogin ? 'rounded-t-md' : ''
                } focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm`}
                placeholder="Email adresi"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Şifre
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className={`appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 ${
                  isLogin ? 'rounded-b-md' : ''
                } focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm`}
                placeholder="Şifre"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400"
            >
              {loading ? (isLogin ? 'Giriş yapılıyor...' : 'Salon oluşturuluyor...') : (isLogin ? 'Giriş Yap' : 'Salon Oluştur')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SalonLogin;