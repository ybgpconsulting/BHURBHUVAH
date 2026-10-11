import React, { useState, useEffect } from 'react';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { api } from '../lib/api';
import { Phone, MessageCircle } from 'lucide-react';

export default function FollowUpsPage() {
  const [timeFilter, setTimeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchFollowUps();
  }, [timeFilter, statusFilter]);

  const fetchFollowUps = async () => {
    setLoading(true);
    setError('');
    try {
      let url = `/api/followups?`;
      if (timeFilter !== 'all') {
        const daysMap: Record<string, number> = { '7d': 7, '3d': 3, 'tomorrow': 1, 'today': 0, 'expired': -1 };
        url += `days=${daysMap[timeFilter]}&`;
      }
      if (statusFilter !== 'all') {
        url += `status=${statusFilter}&`;
      }
      const result = await api.get(url);
      setData(result || []);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: string, action: string, payload?: any) => {
    try {
      await api.put(`/api/followups/${id}`, { action, ...payload });
      fetchFollowUps();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to update follow-up');
    }
  };

  const getUrgencyColor = (days: number) => {
    if (days < 0) return 'bg-red-50';
    if (days <= 3) return 'bg-orange-50';
    if (days <= 7) return 'bg-yellow-50';
    return '';
  };

  const openWhatsApp = (phone: string, text: string = '') => {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Follow-ups & Renewals</h2>
      </div>
      {error && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <div className="flex gap-2 overflow-x-auto pb-2 border-r pr-4 mr-2">
          {['all', '7d', '3d', 'tomorrow', 'today', 'expired'].map(filter => (
            <Button 
              key={filter}
              variant={timeFilter === filter ? 'primary' : 'secondary'}
              onClick={() => setTimeFilter(filter)}
              className="capitalize"
            >
              {filter === '7d' ? 'Expiring 7 days' : filter === '3d' ? '3 days' : filter}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {['all', 'pending', 'contacted', 'interested', 'renewed', 'not_interested', 'no_response'].map(filter => (
            <Button 
              key={filter}
              variant={statusFilter === filter ? 'primary' : 'secondary'}
              onClick={() => setStatusFilter(filter)}
              className="capitalize"
            >
              {filter.replace('_', ' ')}
            </Button>
          ))}
        </div>
      </div>

      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Customer</Th>
              <Th>Plan/Product</Th>
              <Th>End Date</Th>
              <Th>Days Left</Th>
              <Th>Status</Th>
              <Th>Last Contact</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              <Tr><Td colSpan={7} className="text-center py-8">Loading...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={7} className="text-center py-8 text-gray-500">No follow-ups found.</Td></Tr>
            ) : (
              data.map((item) => (
                <Tr key={item.id} className={getUrgencyColor(item.days_left)}>
                  <Td>
                    <div className="font-medium">{item.customer_name}</div>
                    <div className="text-xs text-gray-500 flex gap-2">
                      <span className="flex items-center gap-1 cursor-pointer hover:text-blue-600" onClick={() => openWhatsApp(item.phone)}>
                        <Phone size={12} /> {item.phone}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <div>{item.plan_name}</div>
                    <div className="text-xs text-gray-500">{item.product_name}</div>
                  </Td>
                  <Td>{item.end_date}</Td>
                  <Td>
                    <span className={`font-bold ${item.days_left < 0 ? 'text-red-600' : item.days_left <= 3 ? 'text-orange-600' : 'text-gray-900'}`}>
                      {item.days_left < 0 ? 'Expired' : `${item.days_left} days`}
                    </span>
                  </Td>
                  <Td>
                    <Badge variant={item.status === 'renewed' ? 'success' : item.status === 'pending' ? 'warning' : 'secondary'}>
                      {item.status.replace('_', ' ')}
                    </Badge>
                  </Td>
                  <Td className="text-sm text-gray-500">{item.last_contact_date || 'Never'}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openWhatsApp(item.phone, `Hi ${item.customer_name}, your milk subscription is expiring soon.`)} title="WhatsApp">
                        <MessageCircle size={14} />
                      </Button>
                      <select 
                        className="text-sm border border-gray-300 rounded-md py-1 px-2"
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAction(item.id, e.target.value);
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">Action...</option>
                        <option value="mark_contacted">Mark Contacted</option>
                        <option value="mark_interested">Mark Interested</option>
                        <option value="mark_not_interested">Not Interested</option>
                        <option value="no_response">No Response</option>
                        <option value="record_renewal">Record Renewal</option>
                      </select>
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
