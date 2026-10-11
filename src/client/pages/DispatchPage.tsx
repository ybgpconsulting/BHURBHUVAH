import React, { useState, useEffect } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardContent } from '../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Download, Lock, Clock, AlertCircle } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { api } from '../lib/api';

const TIMEZONE = 'Asia/Kolkata';

export default function DispatchPage() {
  const [date, setDate] = useState(formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd'));
  const [dispatchData, setDispatchData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationRuns, setGenerationRuns] = useState<any[]>([]);
  const [assignmentOptions, setAssignmentOptions] = useState<{ routes: any[]; partners: any[] }>({ routes: [], partners: [] });
  const [assignments, setAssignments] = useState<Record<string, { route_id: string; assigned_partner_id: string }>>({});

  useEffect(() => {
    fetchDispatch();
    fetchGenerationRuns();
  }, [date]);

  useEffect(() => {
    api.get('/api/dispatch/assignment-options').then(setAssignmentOptions).catch(() => {});
  }, []);

  const fetchGenerationRuns = async () => {
    try {
      setGenerationRuns(await api.get('/api/dispatch/generation-runs'));
    } catch {
      setGenerationRuns([]);
    }
  };

  const fetchDispatch = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/api/dispatch?date=${date}`);
      setDispatchData(data);
    } catch (e: any) {
      if (e.message !== 'Not Found' && e.message !== 'No dispatch data') {
        setError(e.message || 'Failed to fetch dispatch data');
      } else {
        setDispatchData(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const data = await api.post('/api/dispatch/generate', { date });
      setDispatchData(data);
      fetchGenerationRuns();
    } catch (e: any) {
      setError(e.message || 'Failed to generate dispatch');
    } finally {
      setGenerating(false);
    }
  };

  const handleLock = async () => {
    if (!confirm('Publish this dispatch to the assigned delivery partners? Publishing prevents direct edits; create a revision to make changes.')) {
      return;
    }
    try {
      const data = await api.put(`/api/dispatch/${dispatchData.id}/lock`);
      setDispatchData(data);
    } catch (e: any) {
      setError(e.message || 'Failed to lock dispatch');
    }
  };

  const handleRevise = async () => {
    try {
      const data = await api.post(`/api/dispatch/${dispatchData.id}/revise`);
      setDispatchData(data);
      setAssignments({});
    } catch (e: any) {
      setError(e.message || 'Failed to create dispatch revision');
    }
  };

  const saveAssignment = async (delivery: any) => {
    const assignment = assignments[delivery.id] || {
      route_id: delivery.route_id || '',
      assigned_partner_id: delivery.assigned_partner_id || '',
    };
    try {
      await api.put(`/api/dispatch/${dispatchData.id}/deliveries/${delivery.id}/assignment`, assignment);
      fetchDispatch();
    } catch (e: any) {
      setError(e.message || 'Failed to update assignment');
    }
  };

  const retryGeneration = async (deliveryDate: string) => {
    try {
      const result = await api.post(`/api/dispatch/generation-runs/${deliveryDate}/retry`);
      await Promise.all([fetchDispatch(), fetchGenerationRuns()]);
      if (result.status === 'needs_review') {
        setError(result.result?.validation_errors?.join('; ') || 'Dispatch requires review before publishing.');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to retry scheduled generation');
    }
  };

  const downloadMasterSheet = () => {
    api.download(`/api/exports/packing-sheet/${dispatchData.id}`, `master_dispatch_${date}.xlsx`);
  };

  const downloadRouteSheets = () => {
    api.download(`/api/exports/route-sheet/${dispatchData.id}`, `routes_${date}.xlsx`);
  };

  const downloadRouteSheet = (route: any) => {
    api.download(
      `/api/exports/route-sheet/${dispatchData.id}?route_id=${encodeURIComponent(route.id)}`,
      `route_${date}_${route.id}.xlsx`,
    );
  };

  const downloadMasterPDF = () => {
    api.download(`/api/exports/packing-pdf/${dispatchData.id}`, `master_dispatch_${date}.pdf`);
  };

  const downloadRoutePDF = (route: any) => {
    api.download(
      `/api/exports/packing-pdf/${dispatchData.id}?route_id=${encodeURIComponent(route.id)}`,
      `route_${date}_${route.id}.pdf`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Daily Dispatch</h2>
        <div className="flex items-center gap-4">
          <Input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)} 
          />
          <Button onClick={handleGenerate} disabled={generating || dispatchData?.status === 'locked'}>
            {generating ? 'Generating...' : 'Generate Dispatch'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-md flex items-center gap-2">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {generationRuns.filter((run) => run.delivery_date === date && ['failed', 'needs_review'].includes(run.status)).map((run) => (
        <div key={run.id} className="p-4 bg-amber-50 text-amber-900 rounded-md flex flex-wrap items-center justify-between gap-3">
          <span>
            Scheduled generation {run.status === 'failed' ? 'failed' : 'needs review'} for {run.delivery_date}.
            {run.error_message ? ` ${run.error_message}` : ''}
            {run.result_json ? ` ${(JSON.parse(run.result_json).validation_errors || []).join('; ')}` : ''}
          </span>
          {run.status === 'failed' && <Button size="sm" onClick={() => retryGeneration(run.delivery_date)}>Retry safely</Button>}
        </div>
      ))}

      {!dispatchData && !loading ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200 shadow-sm">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Dispatch Data</h3>
          <p className="text-gray-500 mb-4">No dispatch has been generated for {date} yet.</p>
          <Button onClick={handleGenerate} disabled={generating}>
            Generate Now
          </Button>
        </div>
      ) : loading ? (
        <div className="text-center py-12">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="py-6">
                <h3 className="text-gray-500 text-sm font-medium">Total Orders</h3>
                <p className="text-3xl font-bold mt-2">{dispatchData.summary?.totalOrders || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-6">
                <h3 className="text-gray-500 text-sm font-medium">Total Qty (Liters)</h3>
                <p className="text-3xl font-bold mt-2">{dispatchData.summary?.totalVolume || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-6">
                <h3 className="text-gray-500 text-sm font-medium">Routes</h3>
                <p className="text-3xl font-bold mt-2">{dispatchData.summary?.totalRoutes || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-6">
                <h3 className="text-gray-500 text-sm font-medium">Status · Revision {dispatchData.revision || 1}</h3>
                <div className="mt-2">
                  {dispatchData.status === 'locked' ? (
                    <Badge variant="success" className="flex items-center gap-1 w-max">
                      <Lock size={14} /> Locked
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="flex items-center gap-1 w-max">
                      <Clock size={14} /> Draft
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="secondary" className="gap-2" onClick={downloadMasterSheet}>
              <Download size={16} /> Master Sheet (XLSX)
            </Button>
            <Button variant="secondary" className="gap-2" onClick={downloadRouteSheets}>
              <Download size={16} /> Route Sheets (XLSX)
            </Button>
            <Button variant="secondary" className="gap-2" onClick={downloadMasterPDF}>
              <Download size={16} /> Master PDF
            </Button>
            {dispatchData.status !== 'locked' && (
              <Button variant="danger" className="gap-2" onClick={handleLock}>
                <Lock size={16} /> Lock Dispatch
              </Button>
            )}
            {dispatchData.status === 'locked' && (
              <Button variant="secondary" className="gap-2" onClick={handleRevise}>
                Create Revision
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h3 className="font-medium text-gray-900">Route-wise Breakdown</h3>
              </div>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Route</Th>
                    <Th>Stops</Th>
                    <Th>Volume (L)</Th>
                    <Th>Exports</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(dispatchData.routes || []).map((route: any, i: number) => (
                    <Tr key={i}>
                      <Td className="font-medium">{route.name}</Td>
                      <Td>{route.stops}</Td>
                      <Td>{route.volume}</Td>
                      <Td>
                        {route.id && (
                          <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => downloadRouteSheet(route)}>
                              Excel
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => downloadRoutePDF(route)}>
                              PDF
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  ))}
                  {(!dispatchData.routes || dispatchData.routes.length === 0) && (
                    <Tr><Td colSpan={4} className="text-center py-4 text-gray-500">No route data</Td></Tr>
                  )}
                </Tbody>
              </Table>
            </div>

            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h3 className="font-medium text-gray-900">Partner Workload</h3>
              </div>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Partner</Th>
                    <Th>Route</Th>
                    <Th>Stops</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(dispatchData.partners || []).map((partner: any, i: number) => (
                    <Tr key={i}>
                      <Td className="font-medium">{partner.name}</Td>
                      <Td>{partner.route}</Td>
                      <Td>{partner.stops}</Td>
                    </Tr>
                  ))}
                  {(!dispatchData.partners || dispatchData.partners.length === 0) && (
                    <Tr><Td colSpan={3} className="text-center py-4 text-gray-500">No partner data</Td></Tr>
                  )}
                </Tbody>
              </Table>
            </div>
          </div>

          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden mt-6">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Full Delivery List</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Route</Th>
                    <Th>Customer</Th>
                    <Th>Product</Th>
                    <Th>Qty</Th>
                    <Th>Partner</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(dispatchData.deliveries || []).map((del: any) => (
                    <Tr key={del.id}>
                      <Td>{del.route_name || 'Unassigned'}</Td>
                      <Td>
                        <div>
                          <div className="font-medium">{del.customer_name}</div>
                          <div className="text-xs text-gray-500">{del.address}</div>
                        </div>
                      </Td>
                      <Td>{del.product_name}</Td>
                      <Td>{del.quantity}</Td>
                      <Td>
                        {dispatchData.status === 'draft' ? (
                          <div className="min-w-52 space-y-2">
                            <select
                              className="w-full rounded border p-1"
                              value={(assignments[del.id] || {}).route_id ?? del.route_id ?? ''}
                              onChange={(event) => setAssignments((current) => ({
                                ...current,
                                [del.id]: {
                                  route_id: event.target.value,
                                  assigned_partner_id: (current[del.id]?.assigned_partner_id ?? del.assigned_partner_id) || '',
                                },
                              }))}
                            >
                              <option value="">Choose route</option>
                              {assignmentOptions.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
                            </select>
                            <select
                              className="w-full rounded border p-1"
                              value={(assignments[del.id] || {}).assigned_partner_id ?? del.assigned_partner_id ?? ''}
                              onChange={(event) => setAssignments((current) => ({
                                ...current,
                                [del.id]: {
                                  route_id: current[del.id]?.route_id ?? del.route_id ?? '',
                                  assigned_partner_id: event.target.value,
                                },
                              }))}
                            >
                              <option value="">Choose delivery partner</option>
                              {assignmentOptions.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
                            </select>
                            <Button size="sm" onClick={() => saveAssignment(del)}>Save assignment</Button>
                          </div>
                        ) : (
                          <>{del.partner_name || 'Unassigned'}{del.changed_after_publish ? <Badge variant="warning" className="ml-2">Changed in revision</Badge> : null}</>
                        )}
                      </Td>
                      <Td>
                        <Badge variant={
                          del.status === 'completed' ? 'success' :
                          del.status === 'missed' ? 'danger' :
                          del.status === 'partial' ? 'warning' : 'secondary'
                        }>
                          {del.status}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                  {(!dispatchData.deliveries || dispatchData.deliveries.length === 0) && (
                    <Tr>
                      <Td colSpan={6} className="text-center py-8 text-gray-500">
                        No delivery items.
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
