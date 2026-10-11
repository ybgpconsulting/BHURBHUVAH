import React from 'react';
import clsx from 'clsx';

export const Card = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <div className={clsx('bg-white rounded-lg shadow-sm border border-gray-200', className)}>
    {children}
  </div>
);

export const CardHeader = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <div className={clsx('px-6 py-4 border-b border-gray-200', className)}>
    {children}
  </div>
);

export const CardTitle = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <h3 className={clsx('text-lg font-medium leading-6 text-gray-900', className)}>
    {children}
  </h3>
);

export const CardContent = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <div className={clsx('px-6 py-4', className)}>
    {children}
  </div>
);
