import React from 'react';
import { Card } from './Card';
import clsx from 'clsx';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  onClick?: () => void;
  className?: string;
}

export const StatsCard = ({ title, value, icon, trend, onClick, className }: StatsCardProps) => {
  return (
    <Card 
      className={clsx(
        className,
        onClick && 'cursor-pointer hover:shadow-md transition-shadow'
      )}
    >
      <div className="px-5 py-5" onClick={onClick}>
        <div className="flex items-center">
          <div className="flex-shrink-0 rounded-md p-3 bg-blue-50 text-blue-600">
            {icon}
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
              <dd>
                <div className="text-2xl font-bold text-gray-900">{value}</div>
              </dd>
            </dl>
          </div>
        </div>
        
        {trend && (
          <div className="mt-4 flex items-center text-sm">
            {trend.value >= 0 ? (
              <ArrowUpRight className="flex-shrink-0 h-4 w-4 text-green-500 mr-1" />
            ) : (
              <ArrowDownRight className="flex-shrink-0 h-4 w-4 text-red-500 mr-1" />
            )}
            <span className={trend.value >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
              {Math.abs(trend.value)}%
            </span>
            <span className="ml-2 text-gray-500">{trend.label}</span>
          </div>
        )}
      </div>
    </Card>
  );
};
