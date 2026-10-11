import React from 'react';
import { Card, CardContent } from '../components/ui/Card';

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
      </div>
      
      <Card>
        <CardContent className="p-12 text-center text-gray-500">
          Reports dashboard module coming soon.
        </CardContent>
      </Card>
    </div>
  );
}
