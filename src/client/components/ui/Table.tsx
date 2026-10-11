import React from 'react';

export const Table = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-gray-200">
      {children}
    </table>
  </div>
);

export const Thead = ({ children }: { children: React.ReactNode }) => (
  <thead className="bg-gray-50">
    {children}
  </thead>
);

export const Tbody = ({ children }: { children: React.ReactNode }) => (
  <tbody className="bg-white divide-y divide-gray-200">
    {children}
  </tbody>
);

export const Tr = ({ children, className, onClick, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={className} onClick={onClick} {...props}>
    {children}
  </tr>
);

export const Th = ({ children, className, colSpan, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" colSpan={colSpan} className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${className || ''}`} {...props}>
    {children}
  </th>
);

export const Td = ({ children, className, colSpan, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td colSpan={colSpan} className={`px-6 py-4 whitespace-nowrap text-sm text-gray-500 ${className || ''}`} {...props}>
    {children}
  </td>
);
