import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { MapPin, Phone, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { formatInTimeZone } from 'date-fns-tz';

const TIMEZONE = 'Asia/Kolkata';

export default function DeliveryPartnerPage() {
  const { logout } = useAuth();
  const [date, setDate] = useState(formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd'));
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [dispatch, setDispatch] = useState<any>(null);
  const [supersededRevisions, setSupersededRevisions] = useState<any[]>([]);
  const [summary, setSummary] = useState({ total: 0, completed: 0, pending: 0, missed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modal states
  const [activeDelivery, setActiveDelivery] = useState<any>(null);
  const [modalType, setModalType] = useState<'partial' | 'missed' | null>(null);
  const [reason, setReason] = useState('');
  const [actualQuantities, setActualQuantities] = useState<Record<string, string>>({});

  const fetchDeliveries = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/api/deliveries/my?date=${date}`);
      setDeliveries(data.deliveries || []);
      setDispatch(data.dispatch);
      setSupersededRevisions(data.superseded_revisions || []);
      setSummary({
        total: data.deliveries?.length || 0,
        completed: data.deliveries?.filter((d: any) => d.status === 'completed').length || 0,
        pending: data.deliveries?.filter((d: any) => d.status === 'pending').length || 0,
        missed: data.deliveries?.filter((d: any) => d.status === 'missed').length || 0,
      });
    } catch (e: any) {
      setError(e.message || 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
  }, [date]);

  const handleStatusUpdate = async (id: string, status: string, payload: any = {}) => {
    try {
      await api.put(`/api/deliveries/${id}/status`, { status, ...payload });
      setModalType(null);
      setActiveDelivery(null);
      setReason('');
      setActualQuantities({});
      fetchDeliveries();
    } catch (e: any) {
      alert(e.message || 'Failed to update status');
    }
  };

  const openMap = (address: string) => {
    window.open(`https://maps.google.com/?q=${encodeURIComponent(address)}`, '_blank');
  };

  const pendingProgress = summary.total > 0 ? (summary.completed / summary.total) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      <header className="bg-blue-600 text-white p-4 sticky top-0 z-10 flex flex-col gap-3 shadow-md">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold">My Deliveries</h1>
          <Button variant="ghost" size="sm" className="text-white hover:bg-blue-700 p-0 px-2" onClick={logout}>Logout</Button>
        </div>
        <div className="flex items-center gap-2">
          <Input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-white text-gray-900 border-none shadow-inner"
          />
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-md mx-auto">
        {dispatch && (
          <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
            Current assignment · Dispatch revision {dispatch.revision} · Published {dispatch.locked_at ? new Date(dispatch.locked_at).toLocaleString() : ''}
          </div>
        )}
        {supersededRevisions.length > 0 && (
          <div className="rounded-md bg-gray-100 p-3 text-sm text-gray-700">
            Superseded dispatch revisions: {supersededRevisions.map((revision: any) => `#${revision.revision} (${revision.assigned_deliveries} prior stop(s))`).join(', ')}.
            Use the current assignment above.
          </div>
        )}
        <Card className="shadow-sm border-blue-100">
          <CardContent className="p-4">
            <div className="flex justify-between items-center mb-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-800">{summary.total}</p>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{summary.completed}</p>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Done</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{summary.pending}</p>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Pending</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-500">{summary.missed}</p>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Missed</p>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div className="bg-green-600 h-2.5 rounded-full" style={{ width: `${pendingProgress}%` }}></div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="bg-red-50 p-3 rounded text-red-600 text-sm flex items-center justify-between">
            <span>{error}</span>
            <Button size="sm" variant="ghost" onClick={fetchDeliveries}>Retry</Button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-10 text-gray-500">Loading deliveries...</div>
        ) : deliveries.length === 0 ? (
          <div className="text-center py-10 text-gray-500 bg-white rounded-lg border border-gray-200">
            {dispatch ? 'No deliveries assigned to your account for this date.' : 'The manager has not published a dispatch for this date.'}
          </div>
        ) : (
          <div className="space-y-4 pb-10">
            {deliveries.map((delivery, index) => (
              <Card key={delivery.id} className="overflow-hidden shadow-sm border border-gray-200">
                <div className={`p-3 border-b flex justify-between items-center ${
                  delivery.status === 'pending' ? 'bg-blue-50 border-blue-100' :
                  delivery.status === 'completed' ? 'bg-green-50 border-green-100' :
                  'bg-gray-50 border-gray-200'
                }`}>
                  <span className={`font-bold ${delivery.status === 'pending' ? 'text-blue-900' : 'text-gray-700'}`}>
                    Stop #{index + 1}
                  </span>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full uppercase ${
                    delivery.status === 'pending' ? 'bg-blue-200 text-blue-800' :
                    delivery.status === 'completed' ? 'bg-green-200 text-green-800' :
                    delivery.status === 'missed' ? 'bg-red-200 text-red-800' :
                    'bg-yellow-200 text-yellow-800'
                  }`}>
                    {delivery.status}
                  </span>
                </div>
                <CardContent className="p-4 space-y-4">
                  {delivery.changed_after_publish === 1 && (
                    <div className="rounded bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                      Assignment changed in this published revision.
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-xl text-gray-900">{delivery.customer_name}</h3>
                    <div 
                      className="text-sm text-gray-600 flex items-start gap-2 mt-2 cursor-pointer bg-gray-50 p-2 rounded-md active:bg-gray-100"
                      onClick={() => openMap(delivery.address)}
                    >
                      <MapPin size={18} className="text-blue-500 mt-0.5 flex-shrink-0" /> 
                      <span>{delivery.address}</span>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 p-3 rounded-md border border-gray-100">
                    <div className="font-semibold mb-2 text-gray-700 border-b pb-1">Products to deliver:</div>
                    <ul className="space-y-1">
                      {delivery.products?.map((p: any, i: number) => (
                        <li key={i} className="flex justify-between items-center">
                          <span className="font-medium text-gray-800">{p.name}</span>
                          <span className="bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded text-sm">{p.quantity} {p.unit}</span>
                        </li>
                      ))}
                      {(!delivery.products || delivery.products.length === 0) && (
                        <li className="flex justify-between items-center">
                           <span className="font-medium text-gray-800">{delivery.product_name}</span>
                           <span className="bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded text-sm">{delivery.quantity}</span>
                        </li>
                      )}
                    </ul>
                  </div>

                  {delivery.instructions && (
                    <div className="bg-yellow-50 text-yellow-800 p-2 text-sm rounded-md border border-yellow-200 flex items-start gap-2">
                      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                      <span>{delivery.instructions}</span>
                    </div>
                  )}

                  {delivery.status === 'pending' && (
                    <div className="space-y-2">
                      <Button 
                        className="w-full bg-green-600 hover:bg-green-700 py-6 text-lg font-bold shadow-sm"
                        onClick={() => handleStatusUpdate(delivery.id, 'completed')}
                      >
                        <CheckCircle size={24} className="mr-2" /> Mark Delivered
                      </Button>
                      
                      <div className="flex gap-2">
                        <Button 
                          variant="secondary" 
                          className="flex-1 py-4 text-yellow-700 border-yellow-300 bg-yellow-50 hover:bg-yellow-100"
                          onClick={() => { setActiveDelivery(delivery); setModalType('partial'); }}
                        >
                          Partial
                        </Button>
                        <Button 
                          variant="secondary" 
                          className="flex-1 py-4 text-red-700 border-red-300 bg-red-50 hover:bg-red-100"
                          onClick={() => { setActiveDelivery(delivery); setModalType('missed'); }}
                        >
                          <XCircle size={18} className="mr-1" /> Missed
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  <a href={`tel:${delivery.phone}`} className="block">
                    <Button variant="outline" className="w-full mt-2 gap-2 text-blue-600 border-blue-200 hover:bg-blue-50 py-4">
                      <Phone size={18} /> Call Customer
                    </Button>
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {modalType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-sm p-5 shadow-xl">
            <h3 className="text-lg font-bold mb-4">
              {modalType === 'partial' ? 'Partial Delivery' : 'Mark Missed Delivery'}
            </h3>
            
            <div className="space-y-4">
              {modalType === 'partial' && (
                activeDelivery.products.map((product: any) => (
                  <div key={product.id}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Actual {product.name} ({product.unit}; planned {product.planned_quantity})
                    </label>
                    <Input
                      type="number"
                      min="0"
                      max={product.planned_quantity}
                      step="0.1"
                      value={actualQuantities[product.id] || ''}
                      onChange={(e) => setActualQuantities((current) => ({ ...current, [product.id]: e.target.value }))}
                      placeholder="Enter quantity"
                    />
                  </div>
                ))
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea 
                  className="w-full border-gray-300 rounded-md shadow-sm p-2 border"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter reason..."
                />
              </div>
              
              <div className="flex gap-2 pt-2">
                <Button 
                  variant="secondary" 
                  className="flex-1"
                  onClick={() => { setModalType(null); setActiveDelivery(null); setActualQuantities({}); }}
                >
                  Cancel
                </Button>
                <Button 
                  className="flex-1"
                  onClick={() => handleStatusUpdate(
                    activeDelivery.id, 
                    modalType, 
                    {
                      reason,
                      items: activeDelivery.products.map((product: any) => ({
                        id: product.id,
                        actual_quantity: Number(actualQuantities[product.id]),
                      })),
                    }
                  )}
                  disabled={modalType === 'partial' && activeDelivery.products.some((product: any) =>
                    actualQuantities[product.id] === undefined || actualQuantities[product.id] === ''
                  )}
                >
                  Confirm
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
