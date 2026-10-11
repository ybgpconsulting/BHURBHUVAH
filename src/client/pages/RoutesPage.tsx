import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';

type RouteForm = { name: string; description: string; assigned_partner_id: string; is_active: number };
const emptyForm: RouteForm = { name: '', description: '', assigned_partner_id: '', is_active: 1 };

export default function RoutesPage() {
  const [data, setData] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<any>(null);
  const [form, setForm] = useState<RouteForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    void fetchRoutes();
    api.get<any[]>('/api/users')
      .then(users => setPartners(users.filter(user => user.role === 'delivery_partner' && user.is_active)))
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Failed to load delivery partners'));
  }, []);

  const fetchRoutes = async () => {
    try {
      setData(await api.get('/api/routes'));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load routes');
    }
  };

  const openCreate = () => {
    setSelectedRoute(null);
    setForm(emptyForm);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (route: any) => {
    setSelectedRoute(route);
    setForm({
      name: route.name,
      description: route.description || '',
      assigned_partner_id: route.assigned_partner_id || '',
      is_active: route.is_active,
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const saveRoute = async () => {
    if (!form.name.trim()) {
      setFormError('A route name is required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (selectedRoute) await api.put(`/api/routes/${selectedRoute.id}`, form);
      else await api.post('/api/routes', form);
      setIsModalOpen(false);
      await fetchRoutes();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Failed to save route');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Routes</h2>
        <Button onClick={openCreate}>Add Route</Button>
      </div>
      {error && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{error}</div>}

      <div className="bg-white shadow-sm border border-gray-200 rounded-lg">
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Assigned Partner</Th>
              <Th>Customer Count</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {data.length === 0 ? (
              <Tr><Td colSpan={4} className="text-center py-8 text-gray-500">No routes found.</Td></Tr>
            ) : data.map(route => (
              <Tr key={route.id}>
                <Td>{route.name}</Td>
                <Td>{route.partner_name || 'Unassigned'}</Td>
                <Td>{route.customer_count}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => openEdit(route)}>Edit</Button></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={selectedRoute ? 'Edit Route' : 'Add Route'} footer={
        <>
          <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
          <Button onClick={saveRoute} isLoading={saving}>{selectedRoute ? 'Save Changes' : 'Create Route'}</Button>
        </>
      }>
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-700" role="alert">{formError}</div>}
          <Input label="Route name" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          <Input label="Description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
          <Select
            label="Assigned delivery partner"
            value={form.assigned_partner_id}
            onChange={event => setForm({ ...form, assigned_partner_id: event.target.value })}
            options={[{ value: '', label: 'Unassigned' }, ...partners.map(partner => ({ value: partner.id, label: partner.name }))]}
          />
          <Select
            label="Status"
            value={String(form.is_active)}
            onChange={event => setForm({ ...form, is_active: Number(event.target.value) })}
            options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]}
          />
        </div>
      </Modal>
    </div>
  );
}
