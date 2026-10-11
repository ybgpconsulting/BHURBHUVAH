import React, { useState, useEffect } from 'react';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { formatInTimeZone } from 'date-fns-tz';
import { useSearchParams } from 'react-router-dom';

export default function SubscriptionsPage() {
  type Operation = 'create' | 'edit' | 'pause' | 'resume';
  const [data, setData] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [operation, setOperation] = useState<Operation>('create');
  const [selectedId, setSelectedId] = useState('');
  const [actionDate, setActionDate] = useState(formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'));
  const [pauseEndDate, setPauseEndDate] = useState('');
  const [form, setForm] = useState({
    customer_id: '',
    plan_template_id: '',
    start_date: formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'),
    end_date: '',
    delivery_days: '1,2,3,4,5,6,7',
    price: '',
    status: 'active',
  });
  const [items, setItems] = useState([{ product_id: '', quantity: '1' }]);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    try {
      setData(await api.get('/api/subscriptions'));
    } catch (error) {
      console.error(error);
      setFormError(error instanceof Error ? error.message : 'Failed to load subscriptions');
    }
  };

  const openCreateModal = async () => {
    setOperation('create');
    setSelectedId('');
    setFormError('');
    setIsModalOpen(true);
    setItems([{ product_id: '', quantity: '1' }]);
    setForm({
      customer_id: '',
      plan_template_id: '',
      start_date: formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'),
      end_date: '',
      delivery_days: '1,2,3,4,5,6,7',
      price: '',
      status: 'active',
    });
    await loadOptions();
  };

  const loadOptions = async () => {
    try {
      const [customerResponse, availablePlans, availableProducts] = await Promise.all([
        api.get('/api/customers?page=1&pageSize=100'),
        api.get<any[]>('/api/plans'),
        api.get<any[]>('/api/products?is_active=true'),
      ]);
      setCustomers(customerResponse.data || []);
      setPlans(availablePlans.filter(plan => plan.is_active));
      setProducts(availableProducts);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to load subscription options');
    }
  };

  const openEditModal = async (subscriptionId: string) => {
    setOperation('edit');
    setSelectedId(subscriptionId);
    setFormError('');
    setIsModalOpen(true);
    const effectiveDate = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    setActionDate(effectiveDate);
    try {
      const [subscription, customerResponse, availablePlans, availableProducts] = await Promise.all([
        api.get<any>(`/api/subscriptions/${subscriptionId}?effective_date=${effectiveDate}`),
        api.get('/api/customers?page=1&pageSize=100'),
        api.get<any[]>('/api/plans'),
        api.get<any[]>('/api/products?is_active=true'),
      ]);
      setCustomers(customerResponse.data || []);
      setPlans(availablePlans.filter(plan => plan.is_active));
      setProducts(availableProducts);
      setForm({
        customer_id: subscription.customer_id,
        plan_template_id: subscription.plan_template_id,
        start_date: subscription.start_date,
        end_date: subscription.end_date,
        delivery_days: subscription.delivery_days,
        price: subscription.price == null ? '' : String(subscription.price),
        status: subscription.status,
      });
      setItems(subscription.items.map((item: any) => ({
        product_id: item.product_id,
        quantity: String(item.quantity),
      })));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to load subscription');
    }
  };

  const openPauseResumeModal = (subscription: any, nextOperation: 'pause' | 'resume') => {
    setOperation(nextOperation);
    setSelectedId(subscription.id);
    setActionDate(formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'));
    setPauseEndDate('');
    setFormError('');
    setIsModalOpen(true);
  };

  const submitPauseResume = async () => {
    setSaving(true);
    setFormError('');
    try {
      const endpoint = operation === 'pause' ? 'pause' : 'resume';
      await api.post(`/api/subscriptions/${selectedId}/${endpoint}`, {
        effective_date: actionDate,
        ...(operation === 'pause' && pauseEndDate ? { end_date: pauseEndDate } : {}),
      });
      setIsModalOpen(false);
      await fetchSubscriptions();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `Failed to ${operation} subscription`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const customerId = searchParams.get('customer_id');
    if (customerId) {
      setForm(current => ({ ...current, customer_id: customerId }));
      openCreateModal();
    }
  }, [searchParams]);

  const createSubscription = async () => {
    const selectedItems = items
      .filter(item => item.product_id)
      .map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) }));
    if (!form.customer_id || !form.plan_template_id || !form.start_date || !selectedItems.length
      || selectedItems.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0)
      || new Set(selectedItems.map(item => item.product_id)).size !== selectedItems.length) {
      setFormError('Choose a customer, plan, start date, and unique products with quantities greater than zero.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (operation === 'edit') {
        await api.put(`/api/subscriptions/${selectedId}`, {
          ...form,
          price: form.price === '' ? null : Number(form.price),
          effective_date: actionDate,
          items: selectedItems,
        });
      } else {
        await api.post('/api/subscriptions', {
          ...form,
          price: form.price === '' ? undefined : Number(form.price),
          items: selectedItems,
        });
      }
      setIsModalOpen(false);
      await fetchSubscriptions();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to create subscription');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Subscriptions</h2>
        <Button onClick={openCreateModal}>Add Subscription</Button>
      </div>

      {formError && !isModalOpen && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{formError}</div>}

      <div className="bg-white shadow-sm border border-gray-200 rounded-lg">
        <Table>
          <Thead>
            <Tr>
              <Th>Customer</Th>
              <Th>Plan</Th>
              <Th>Product(s)</Th>
              <Th>Start</Th>
              <Th>End</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {data.length === 0 ? (
              <Tr><Td colSpan={7} className="text-center py-8 text-gray-500">No subscriptions found.</Td></Tr>
            ) : (
              data.map(sub => (
                <Tr key={sub.id}>
                  <Td>{sub.customer_name}</Td>
                  <Td>{sub.plan_name}</Td>
                  <Td>{sub.product_name}</Td>
                  <Td>{sub.start_date}</Td>
                  <Td>{sub.end_date}</Td>
                  <Td>{sub.status}{sub.is_paused ? ' · paused' : ''}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEditModal(sub.id)}>Edit</Button>
                      {sub.status === 'active' && (
                        <Button size="sm" variant="secondary" onClick={() => openPauseResumeModal(sub, sub.is_paused ? 'resume' : 'pause')}>
                          {sub.is_paused ? 'Resume' : 'Pause'}
                        </Button>
                      )}
                      {sub.status !== 'cancelled' && sub.status !== 'renewed' && (
                        <Button size="sm" variant="secondary" onClick={async () => {
                          try {
                            await api.post(`/api/subscriptions/${sub.id}/renew`);
                            await fetchSubscriptions();
                          } catch (error) {
                            setFormError(error instanceof Error ? error.message : 'Failed to renew subscription');
                          }
                        }}>Renew</Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}
        title={operation === 'create' ? 'Add Subscription' : operation === 'edit' ? 'Edit Subscription' : operation === 'pause' ? 'Pause Subscription' : 'Resume Subscription'} footer={
        <>
          <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
          {operation === 'pause' || operation === 'resume'
            ? <Button onClick={submitPauseResume} isLoading={saving}>{operation === 'pause' ? 'Pause' : 'Resume'}</Button>
            : <Button onClick={createSubscription} isLoading={saving}>{operation === 'edit' ? 'Save Changes' : 'Save Subscription'}</Button>}
        </>
      }>
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-700" role="alert">{formError}</div>}
          {(operation === 'pause' || operation === 'resume') && (
            <>
              <Input
                label="Effective date"
                type="date"
                required
                value={actionDate}
                onChange={(event) => setActionDate(event.target.value)}
              />
              {operation === 'pause' && (
                <Input
                  label="Resume automatically on (optional)"
                  type="date"
                  value={pauseEndDate}
                  onChange={(event) => setPauseEndDate(event.target.value)}
                />
              )}
            </>
          )}
          {(operation === 'create' || operation === 'edit') && <>
          <Select
            label="Customer"
            required
            disabled={operation === 'edit'}
            value={form.customer_id}
            onChange={(event) => setForm({ ...form, customer_id: event.target.value })}
            options={[{ value: '', label: 'Select a customer' }, ...customers.map(customer => ({ value: customer.id, label: customer.name }))]}
          />
          <Select
            label="Plan"
            required
            value={form.plan_template_id}
            onChange={(event) => setForm({ ...form, plan_template_id: event.target.value })}
            options={[{ value: '', label: 'Select a plan' }, ...plans.map(plan => ({ value: plan.id, label: plan.name }))]}
          />
          <Input
            label="Start date"
            type="date"
            required
            value={form.start_date}
            onChange={(event) => setForm({ ...form, start_date: event.target.value })}
          />
          {operation === 'edit' && (
            <>
              <Input
                label="End date"
                type="date"
                required
                value={form.end_date}
                onChange={(event) => setForm({ ...form, end_date: event.target.value })}
              />
              <Input
                label="Product/quantity changes effective from"
                type="date"
                required
                value={actionDate}
                onChange={(event) => setActionDate(event.target.value)}
              />
              <Input
                label="Delivery weekdays (1=Mon through 7=Sun)"
                required
                value={form.delivery_days}
                onChange={(event) => setForm({ ...form, delivery_days: event.target.value })}
              />
              <Select
                label="Status"
                value={form.status || 'active'}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'expired', label: 'Expired' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
            </>
          )}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium text-gray-700">Products</h3>
              <Button variant="secondary" size="sm" onClick={() => setItems([...items, { product_id: '', quantity: '1' }])}>
                Add product
              </Button>
            </div>
            {items.map((item, index) => (
              <div className="flex items-end gap-3" key={index}>
                <Select
                  label={`Product ${index + 1}`}
                  required
                  value={item.product_id}
                  onChange={(event) => setItems(items.map((current, itemIndex) =>
                    itemIndex === index ? { ...current, product_id: event.target.value } : current
                  ))}
                  options={[{ value: '', label: 'Select a product' }, ...products.map(product => ({ value: product.id, label: `${product.name} (${product.unit})` }))]}
                />
                <Input
                  label="Quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={item.quantity}
                  onChange={(event) => setItems(items.map((current, itemIndex) =>
                    itemIndex === index ? { ...current, quantity: event.target.value } : current
                  ))}
                />
                {items.length > 1 && (
                  <Button variant="secondary" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          </>}
        </div>
      </Modal>
    </div>
  );
}
