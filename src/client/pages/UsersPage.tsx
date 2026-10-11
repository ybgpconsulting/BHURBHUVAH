import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';

type UserForm = {
  name: string;
  email: string;
  phone: string;
  role: string;
  is_active: number;
  password: string;
};

const emptyForm: UserForm = {
  name: '',
  email: '',
  phone: '',
  role: 'delivery_partner',
  is_active: 1,
  password: '',
};

export default function UsersPage() {
  const [data, setData] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    void fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setData(await api.get('/api/users'));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load users');
    }
  };

  const openCreate = () => {
    setSelectedUser(null);
    setForm(emptyForm);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (user: any) => {
    setSelectedUser(user);
    setForm({
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      role: user.role,
      is_active: user.is_active,
      password: '',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const saveUser = async () => {
    if (!form.name.trim() || !form.email.trim()
      || (!selectedUser && form.password.length < 12)
      || (form.password && form.password.length < 12)) {
      setFormError('Name and email are required. Passwords must be at least 12 characters.');
      return;
    }
    setLoading(true);
    setFormError('');
    try {
      const payload = { ...form, ...(selectedUser && !form.password ? { password: undefined } : {}) };
      if (selectedUser) {
        await api.put(`/api/users/${selectedUser.id}`, payload);
      } else {
        await api.post('/api/users', payload);
      }
      setIsModalOpen(false);
      await fetchUsers();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Failed to save user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Users</h2>
        <Button onClick={openCreate}>Add User</Button>
      </div>
      {error && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{error}</div>}

      <div className="bg-white shadow-sm border border-gray-200 rounded-lg">
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {data.length === 0 ? (
              <Tr><Td colSpan={5} className="text-center py-8 text-gray-500">No users found.</Td></Tr>
            ) : (
              data.map(user => (
                <Tr key={user.id}>
                  <Td>{user.name}</Td>
                  <Td>{user.email}</Td>
                  <Td>{user.role}</Td>
                  <Td>{user.is_active ? 'active' : 'inactive'}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => openEdit(user)}>Edit</Button></Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedUser ? 'Edit User' : 'Add User'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button onClick={saveUser} isLoading={loading}>{selectedUser ? 'Save Changes' : 'Create User'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-700" role="alert">{formError}</div>}
          <Input label="Name" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          <Input label="Email" type="email" required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
          <Input label="Phone" type="tel" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
          <Select
            label="Role"
            required
            value={form.role}
            onChange={event => setForm({ ...form, role: event.target.value })}
            options={[
              { value: 'owner', label: 'Owner' },
              { value: 'manager', label: 'Manager' },
              { value: 'delivery_partner', label: 'Delivery Partner' },
            ]}
          />
          <Select
            label="Status"
            value={String(form.is_active)}
            onChange={event => setForm({ ...form, is_active: Number(event.target.value) })}
            options={[
              { value: '1', label: 'Active' },
              { value: '0', label: 'Inactive' },
            ]}
          />
          <Input
            label={selectedUser ? 'New password (optional)' : 'Password'}
            type="password"
            required={!selectedUser}
            minLength={12}
            value={form.password}
            onChange={event => setForm({ ...form, password: event.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
