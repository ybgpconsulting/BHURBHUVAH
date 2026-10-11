import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';

const AuthContext = createContext<any>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const data = await api.get('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (credentials: any) => {
    const data = await api.post('/api/auth/login', credentials);
    setUser(data.user);
    if (data.user.role === 'delivery_partner') {
      navigate('/deliveries');
    } else {
      navigate('/');
    }
  };

  const logout = async () => {
    await api.post('/api/auth/logout', {});
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (user.role === 'delivery_partner' && !location.pathname.startsWith('/deliveries')) {
    return <Navigate to="/deliveries" replace />;
  }

  return <>{children}</>;
};

export const RoleGuard = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles: string[] }) => {
  const { user } = useAuth();
  if (!user) return null;
  if (!allowedRoles.includes(user.role)) return <div className="p-4 text-red-600 bg-red-50 rounded">Access Denied: You do not have permission to view this page.</div>;
  return <>{children}</>;
};
