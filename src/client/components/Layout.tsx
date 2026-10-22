import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Home, Users, Package, FileText, Repeat, Map, Truck, Phone, BarChart, Settings, LogOut, Menu, X, Target } from 'lucide-react';
import clsx from 'clsx';

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { name: 'Dashboard', path: '/', icon: Home, roles: ['owner', 'admin', 'manager'] },
    { name: 'Customers', path: '/customers', icon: Users, roles: ['owner', 'admin', 'manager'] },
    { name: 'Products', path: '/products', icon: Package, roles: ['owner', 'admin'] },
    { name: 'Plans', path: '/plans', icon: FileText, roles: ['owner', 'admin'] },
    { name: 'Subscriptions', path: '/subscriptions', icon: Repeat, roles: ['owner', 'admin', 'manager'] },
    { name: 'Routes', path: '/routes', icon: Map, roles: ['owner', 'admin', 'manager'] },
    { name: 'Daily Dispatch', path: '/dispatch', icon: Truck, roles: ['owner', 'admin', 'manager'] },
    { name: 'Follow-ups', path: '/followups', icon: Phone, roles: ['owner', 'admin', 'manager'] },
    { name: 'Reports', path: '/reports', icon: BarChart, roles: ['owner', 'admin'] },
    { name: 'AI Market Research', path: '/market-research', icon: Target, roles: ['owner', 'manager'] },
    { name: 'Users', path: '/users', icon: Settings, roles: ['owner'] },
  ];

  const filteredNavItems = navItems.filter(item => user && item.roles.includes(user.role));

  const NavContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      <div className="p-4 flex items-center justify-between border-b border-gray-200">
        <span className="text-xl font-bold text-gray-900">Milk Delivery</span>
        <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-gray-500">
          <X size={24} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {filteredNavItems.map((item) => (
            <li key={item.name}>
              <Link
                to={item.path}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
                  location.pathname === item.path
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                )}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <item.icon size={20} className={location.pathname === item.path ? 'text-blue-700' : 'text-gray-400'} />
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
            {user?.name?.[0] || 'U'}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{user?.name}</p>
            <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile sidebar overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-black bg-opacity-50 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}
      
      {/* Sidebar */}
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 ease-in-out md:translate-x-0 md:static',
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <NavContent />
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-4 h-16 flex items-center justify-between shrink-0">
          <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden text-gray-500 hover:text-gray-700">
            <Menu size={24} />
          </button>
          
          <div className="flex-1 text-center md:text-left md:pl-4">
            <h1 className="text-xl font-semibold text-gray-800 capitalize">
              {location.pathname === '/' ? 'Dashboard' : location.pathname.split('/')[1].replace('-', ' ')}
            </h1>
          </div>

          <div className="text-sm text-gray-600 hidden sm:block">
            {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
};
