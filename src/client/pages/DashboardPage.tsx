import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { StatsCard } from '../components/ui/StatsCard';
import { Truck, Users, Package, AlertCircle } from 'lucide-react';
import { Select } from '../components/ui/Select';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { addDays, startOfWeek, startOfMonth, startOfYear, format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const TIMEZONE = 'Asia/Kolkata';

function getDateRange(range: string) {
  const today = parseISO(formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd'));
  let from: Date;
  let to: Date;

  switch (range) {
    case 'today':
      from = today;
      to = today;
      break;
    case 'yesterday':
      from = addDays(today, -1);
      to = from;
      break;
    case 'this-week':
      from = startOfWeek(today, { weekStartsOn: 1 });
      to = today;
      break;
    case 'this-month':
      from = startOfMonth(today);
      to = today;
      break;
    case 'this-year':
      from = startOfYear(today);
      to = today;
      break;
    default:
      from = today;
      to = today;
  }

  return {
    from: format(from, 'yyyy-MM-dd'),
    to: format(to, 'yyyy-MM-dd')
  };
}

const PIE_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function DashboardPage() {
  const [dateRange, setDateRange] = useState('today');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [charts, setCharts] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDashboard = async () => {
      setLoading(true);
      setError('');
      try {
        const { from, to } = getDateRange(dateRange);
        
        const [metricsData, chartsData] = await Promise.all([
          api.get(`/api/dashboard/metrics?from=${from}&to=${to}`),
          api.get(`/api/dashboard/charts?from=${from}&to=${to}`)
        ]);
        
        setStats(metricsData);
        setCharts(chartsData);
      } catch (e: any) {
        console.error(e);
        setError(e.message || 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [dateRange]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <div className="w-48">
          <Select
            options={[
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'this-week', label: 'This Week' },
              { value: 'this-month', label: 'This Month' },
              { value: 'this-year', label: 'This Year' },
            ]}
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-md">
          {error}
        </div>
      )}
      {(stats?.operations?.failed_generations || 0) > 0 && (
        <div className="p-4 bg-amber-50 text-amber-900 rounded-md">
          {stats.operations.failed_generations} scheduled dispatch generation(s) failed or need review.
          <a href="/dispatch" className="ml-2 font-semibold underline">Review dispatches</a>
        </div>
      )}

      {loading && !stats ? (
        <div className="flex justify-center items-center h-64 text-gray-500">
          Loading dashboard...
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Delivery Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatsCard title="Scheduled Deliveries" value={stats?.deliveries?.scheduled || 0} icon={<Truck className="text-blue-500" />} />
              <StatsCard title="Completed Deliveries" value={stats?.deliveries?.completed || 0} icon={<Truck className="text-green-500" />} />
              <StatsCard title="Pending Deliveries" value={stats?.deliveries?.pending || 0} icon={<Truck className="text-yellow-500" />} />
              <StatsCard title="Missed Deliveries" value={stats?.deliveries?.missed || 0} icon={<AlertCircle className="text-red-500" />} />
              <StatsCard title="Planned Quantity" value={stats?.deliveries?.planned_quantity || 0} icon={<Package className="text-indigo-500" />} />
              <StatsCard title="Actual Delivered Quantity" value={stats?.deliveries?.actual_quantity || 0} icon={<Package className="text-green-500" />} />
            </div>
            
            <h3 className="text-lg font-medium mt-6">Customer Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatsCard title="Active Customers" value={stats?.customers?.active || 0} icon={<Users className="text-blue-500" />} />
              <StatsCard title="Active Subscriptions" value={stats?.customers?.active_subscriptions || 0} icon={<Package className="text-green-500" />} />
              <StatsCard title="Expiring Soon" value={stats?.customers?.expiring_soon || 0} icon={<AlertCircle className="text-yellow-500" />} />
              <StatsCard title="New Signups" value={stats?.customers?.new_signups || 0} icon={<Users className="text-purple-500" />} />
            </div>
            
            <h3 className="text-lg font-medium mt-6">Operations Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatsCard title="Active Routes" value={stats?.operations?.total_routes || 0} icon={<Truck className="text-blue-500" />} />
              <StatsCard title="Delivery Partners" value={stats?.operations?.active_partners || 0} icon={<Users className="text-orange-500" />} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-lg font-medium mb-4">Deliveries by Day</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts?.deliveriesByDay || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="scheduled" fill="#8884d8" name="Scheduled" />
                    <Bar dataKey="completed" fill="#82ca9d" name="Completed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-lg font-medium mb-4">Planned vs Actual Qty</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts?.plannedVsActual || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="planned" stroke="#8884d8" name="Planned Qty" />
                    <Line type="monotone" dataKey="actual" stroke="#82ca9d" name="Actual Qty" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-lg font-medium mb-4">Product Volume Breakdown</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={charts?.productVolume || []} dataKey="volume" nameKey="product" cx="50%" cy="50%" outerRadius={80} label>
                      {(charts?.productVolume || []).map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-lg font-medium mb-4">Delivery Completion Rate (%)</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts?.completionRate || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="rate" stroke="#ff7300" name="Completion Rate %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
