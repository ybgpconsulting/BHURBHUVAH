import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { SearchInput } from '../components/ui/SearchInput';
import { Modal } from '../components/ui/Modal';
import { Pagination } from '../components/ui/Pagination';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { useNavigate } from 'react-router-dom';

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', address: '', area: '', route_id: '' });
  const navigate = useNavigate();

  useEffect(() => {
    fetchCustomers();
  }, [search, page]);

  const fetchCustomers = async (targetPage = page) => {
    try {
      const data = await api.get(`/api/customers?search=${encodeURIComponent(search)}&page=${targetPage}&pageSize=10`);
      setCustomers(data.data || []);
      setTotalPages(Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 10))));
      setError('');
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to load customers');
    }
  };

  const openCreateModal = async () => {
    setFormError('');
    setIsModalOpen(true);
    try {
      const availableRoutes = await api.get<any[]>('/api/routes');
      setRoutes(availableRoutes.filter(route => route.is_active));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to load routes');
    }
  };

  const createCustomer = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim() || !form.route_id) {
      setFormError('Name, phone, address, and route are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/api/customers', form);
      setIsModalOpen(false);
      setForm({ name: '', phone: '', address: '', area: '', route_id: '' });
      setPage(1);
      await fetchCustomers(1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
        <Button onClick={openCreateModal}>Add Customer</Button>
      </div>

      {error && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{error}</div>}

      <div className="bg-white shadow-sm border border-gray-200 rounded-lg">
        <div className="p-4 border-b border-gray-200">
          <div className="w-full max-w-md">
            <SearchInput value={search} onChange={setSearch} placeholder="Search customers..." />
          </div>
        </div>
        
        <Table>
          <Thead>
            <Tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Area</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {customers.map((c: any) => (
              <Tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/customers/${c.id}`)}>
                <Td>{c.customer_code}</Td>
                <Td className="font-medium text-gray-900">{c.name}</Td>
                <Td>{c.phone}</Td>
                <Td>{c.area}</Td>
                <Td>
                  <Badge variant={c.status === 'active' ? 'success' : 'default'}>{c.status}</Badge>
                </Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/customers/${c.id}`); }}>View</Button>
                </Td>
              </Tr>
            ))}
            {customers.length === 0 && (
              <Tr>
                <Td colSpan={6} className="text-center py-8 text-gray-500">No customers found.</Td>
              </Tr>
            )}
          </Tbody>
        </Table>
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Customer" footer={
        <>
          <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
          <Button onClick={createCustomer} isLoading={saving}>Save</Button>
        </>
      }>
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-700" role="alert">{formError}</div>}
          <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Phone" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          <Input label="Address" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Select
            label="Route"
            required
            value={form.route_id}
            onChange={(e) => setForm({ ...form, route_id: e.target.value })}
            options={[{ value: '', label: 'Select a route' }, ...routes.map(route => ({ value: route.id, label: route.name }))]}
          />
        </div>
      </Modal>
    </div>
  );
}
