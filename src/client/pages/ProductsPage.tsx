import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';

type ProductForm = { name: string; category: string; unit: string; default_price: string; is_active: number };
const emptyForm: ProductForm = { name: '', category: 'milk', unit: 'litre', default_price: '', is_active: 1 };

export default function ProductsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [data, setData] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    void fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setData(await api.get('/api/products'));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load products');
    }
  };

  const openCreate = () => {
    setSelectedProduct(null);
    setForm(emptyForm);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (product: any) => {
    setSelectedProduct(product);
    setForm({
      name: product.name,
      category: product.category || 'milk',
      unit: product.unit || 'litre',
      default_price: product.default_price == null ? '' : String(product.default_price),
      is_active: product.is_active,
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const saveProduct = async () => {
    const price = form.default_price === '' ? null : Number(form.default_price);
    if (!form.name.trim() || (price !== null && (!Number.isFinite(price) || price < 0))) {
      setFormError('A product name and a non-negative price are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = { ...form, name: form.name.trim(), default_price: price };
      if (selectedProduct) await api.put(`/api/products/${selectedProduct.id}`, payload);
      else await api.post('/api/products', payload);
      setIsModalOpen(false);
      await fetchProducts();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Products</h2>
        {isOwner && <Button onClick={openCreate}>Add Product</Button>}
      </div>
      {error && <div className="p-3 rounded-md bg-red-50 text-red-700" role="alert">{error}</div>}
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg">
        <Table>
          <Thead><Tr><Th>Name</Th><Th>Category</Th><Th>Unit</Th><Th>Price</Th><Th>Status</Th>{isOwner && <Th>Actions</Th>}</Tr></Thead>
          <Tbody>
            {data.length === 0 ? (
              <Tr><Td colSpan={isOwner ? 6 : 5} className="text-center py-8 text-gray-500">No products found.</Td></Tr>
            ) : data.map(product => (
              <Tr key={product.id}>
                <Td>{product.name}</Td>
                <Td>{product.category}</Td>
                <Td>{product.unit}</Td>
                <Td>{product.default_price ?? '-'}</Td>
                <Td>{product.is_active ? 'active' : 'inactive'}</Td>
                {isOwner && <Td><Button size="sm" variant="ghost" onClick={() => openEdit(product)}>Edit</Button></Td>}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={selectedProduct ? 'Edit Product' : 'Add Product'} footer={
        <>
          <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
          <Button onClick={saveProduct} isLoading={saving}>{selectedProduct ? 'Save Changes' : 'Create Product'}</Button>
        </>
      }>
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-700" role="alert">{formError}</div>}
          <Input label="Name" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          <Input label="Category" required value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} />
          <Input label="Unit" required value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })} />
          <Input label="Default price" type="number" min="0" step="0.01" value={form.default_price} onChange={event => setForm({ ...form, default_price: event.target.value })} />
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
