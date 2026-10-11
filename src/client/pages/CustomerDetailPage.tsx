import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<any>(null);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<any[]>([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', address: '', area: '', route_id: '' });

  useEffect(() => {
    if (id) {
      fetchCustomerData();
    }
  }, [id]);

  const fetchCustomerData = async () => {
    setLoading(true);
    try {
      const [custData, subsData] = await Promise.all([
        api.get(`/api/customers/${id}`),
        api.get(`/api/customers/${id}/subscriptions`)
      ]);
      setCustomer(custData);
      setSubscriptions(subsData || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openEdit = async () => {
    if (!customer) return;
    setError('');
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      address: customer.address || '',
      area: customer.area || '',
      route_id: customer.route_id || '',
    });
    try {
      const availableRoutes = await api.get<any[]>('/api/routes');
      setRoutes(availableRoutes.filter(route => route.is_active));
      setIsEditOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load routes');
    }
  };

  const saveCustomer = async () => {
    if (!id || !form.name.trim() || !form.phone.trim() || !form.address.trim() || !form.route_id) {
      setError('Name, phone, address, and route are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.put(`/api/customers/${id}`, {
        ...customer,
        ...form,
        status: customer.status,
      });
      setIsEditOpen(false);
      await fetchCustomerData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update customer');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!customer) return <div>Customer not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Customer Details</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openEdit}>Edit Customer</Button>
          <Button onClick={() => navigate(`/subscriptions?customer_id=${encodeURIComponent(id || '')}`)}>Add Subscription</Button>
        </div>
      </div>
      {error && !isEditOpen && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Name</dt>
                <dd className="mt-1 text-sm text-gray-900">{customer.name} ({customer.customer_code})</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Phone</dt>
                <dd className="mt-1 text-sm text-gray-900">{customer.phone}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Address</dt>
                <dd className="mt-1 text-sm text-gray-900">{customer.address || customer.area}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Active Subscriptions</CardTitle>
            </CardHeader>
            <CardContent>
              {subscriptions.length === 0 ? (
                <div className="text-gray-500 text-sm py-4 text-center">No active subscriptions.</div>
              ) : (
                <div className="space-y-4">
                  {subscriptions.map(sub => (
                    <div key={sub.id} className="p-4 border rounded">
                      <div className="font-bold">{sub.plan_name} - {sub.product_name}</div>
                      <div className="text-sm text-gray-600">Qty: {sub.quantity} | Start: {sub.start_date}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Customer" footer={
        <>
          <Button variant="secondary" onClick={() => setIsEditOpen(false)}>Cancel</Button>
          <Button onClick={saveCustomer} isLoading={saving}>Save Changes</Button>
        </>
      }>
        <div className="space-y-4">
          {error && <div className="text-sm text-red-700" role="alert">{error}</div>}
          <Input label="Name" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          <Input label="Phone" type="tel" required value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
          <Input label="Area" value={form.area} onChange={event => setForm({ ...form, area: event.target.value })} />
          <Input label="Address" required value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} />
          <Select
            label="Route"
            required
            value={form.route_id}
            onChange={event => setForm({ ...form, route_id: event.target.value })}
            options={[{ value: '', label: 'Select a route' }, ...routes.map(route => ({ value: route.id, label: route.name }))]}
          />
        </div>
      </Modal>
    </div>
  );
}
