import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';

type PlanForm = { name: string; duration_days: string; duration_type: string; price: string; description: string; is_active: number };
const emptyForm: PlanForm = { name: '', duration_days: '1', duration_type: 'fixed_days', price: '', description: '', is_active: 1 };

export default function PlansPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [data, setData] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    void fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      setData(await api.get('/api/plans'));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load plans');
    }
  };

  const openCreate = () => {
    setSelectedPlan(null);
    setForm(emptyForm);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (plan: any) => {
    setSelectedPlan(plan);
    setForm({
      name: plan.name,
      duration_days: String(plan.duration_days),
      duration_type: plan.duration_type || 'fixed_days',
      price: plan.price == null ? '' : String(plan.price),
      description: plan.description || '',
      is_active: plan.is_active,
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const savePlan = async () => {
    const days = Number(form.duration_days);
    const price = form.price === '' ? null : Number(form.price);
    if (!form.name.trim() || !Number.isInteger(days) || days < 1
      || (price !== null && (!Number.isFinite(price) || price < 0))) {
      setFormError('Enter a plan name, a positive whole-number duration, and a non-negative price.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        duration_days: days,
        price,
      };
      if (selectedPlan) await api.put(`/api/plans/${selectedPlan.id}`, payload);
      else await api.post('/api/plans', payload);
      setIsModalOpen(false);
      await fetchPlans();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Plans</h2>
        {isOwner && <Button onClick={openCreate}>Add Plan</Button>}
      </div>
      {error && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{error}</div>}
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg">
        <Table>
          <Thead><Tr><Th>Name</Th><Th>Duration</Th>{isOwner && <Th>Actions</Th>}</Tr></Thead>
          <Tbody>
            {data.length === 0 ? (
              <Tr><Td colSpan={isOwner ? 3 : 2} className="text-center py-8 text-gray-500">No plans found.</Td></Tr>
            ) : data.map(plan => (
              <Tr key={plan.id}>
                <Td>{plan.name}</Td>
                <Td>{plan.duration_type === 'calendar_month' ? 'Calendar month' : `${plan.duration_days} days`}</Td>
                {isOwner && <Td><Button size="sm" variant="ghost" onClick={() => openEdit(plan)}>Edit</Button></Td>}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={selectedPlan ? 'Edit Plan' : 'Add Plan'} footer={
        <>
          <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
          <Button onClick={savePlan} isLoading={saving}>{selectedPlan ? 'Save Changes' : 'Create Plan'}</Button>
        </>
      }>
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-700" role="alert">{formError}</div>}
          <Input label="Name" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          <Select
            label="Duration type"
            value={form.duration_type}
            onChange={event => setForm({ ...form, duration_type: event.target.value })}
            options={[{ value: 'fixed_days', label: 'Fixed days' }, { value: 'calendar_month', label: 'Calendar month' }]}
          />
          <Input label="Duration days" type="number" min="1" step="1" required value={form.duration_days} onChange={event => setForm({ ...form, duration_days: event.target.value })} />
          <Input label="Price" type="number" min="0" step="0.01" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} />
          <Input label="Description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
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
