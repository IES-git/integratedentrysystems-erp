import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  FileCheck,
  Package,
  Users,
  Clock,
  AlertCircle,
  TrendingUp,
  DollarSign,
} from 'lucide-react';
import { listEstimates } from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import { quoteStorage, orderStorage } from '@/lib/storage';
import type { Estimate, Customer } from '@/types';

// Map Supabase customers row to our Customer type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomerRow(row: any): Customer {
  return {
    id: row.id,
    name: row.name,
    primaryContactName: row.contact_person || '',
    email: row.email || '',
    phone: row.phone || '',
    billingAddress: [row.address, row.city, row.state, row.zip]
      .filter(Boolean)
      .join(', '),
    shippingAddress: '',
    notes: row.notes || '',
    createdAt: row.created_at,
  };
}

export default function DashboardPage() {
  const { user } = useAuth();

  // State for Supabase data
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);

  // Load data from Supabase on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load estimates from Supabase
        const loadedEstimates = await listEstimates();
        setEstimates(loadedEstimates);

        // Load customers from Supabase
        const { data: customersData } = await supabase
          .from('customers')
          .select('*')
          .order('name');
        if (customersData) {
          setCustomers(customersData.map(mapCustomerRow));
        }
      } catch (err) {
        console.error('Error loading data:', err);
      }
    };

    loadData();
  }, []);

  // Get quotes and orders from local storage (not migrated to Supabase yet)
  const quotes = quoteStorage.getAll();
  const orders = orderStorage.getAll();

  // Stats calculations
  const pendingEstimates = estimates.filter((e) => e.ocrStatus === 'pending' || e.ocrStatus === 'processing').length;
  const draftQuotes = quotes.filter((q) => q.status === 'draft').length;
  const sentQuotes = quotes.filter((q) => q.status === 'sent').length;
  const activeOrders = orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length;

  const roleBasedContent = () => {
    switch (user?.role) {
      case 'sales':
        return (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                title="New Estimates"
                value={pendingEstimates}
                description="Awaiting OCR processing"
                icon={FileText}
                variant="warning"
              />
              <StatCard
                title="Draft Quotes"
                value={draftQuotes}
                description="Ready to send"
                icon={FileCheck}
                variant="default"
              />
              <StatCard
                title="Sent Quotes"
                value={sentQuotes}
                description="Awaiting response"
                icon={Clock}
                variant="accent"
              />
              <StatCard
                title="Total Customers"
                value={customers.length}
                description="In your CRM"
                icon={Users}
                variant="success"
              />
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-xl">Recent Estimates</CardTitle>
                  <CardDescription>Latest PDF uploads requiring attention</CardDescription>
                </CardHeader>
                <CardContent>
                  {estimates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No estimates yet. Upload a Ceco PDF to get started.</p>
                  ) : (
                    <div className="space-y-3">
                      {estimates.slice(0, 5).map((estimate) => (
                        <div
                          key={estimate.id}
                          className="flex items-center justify-between rounded-lg border border-border p-3"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">{estimate.originalFileName}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(estimate.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <OcrStatusBadge status={estimate.ocrStatus} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-xl">Quick Actions</CardTitle>
                  <CardDescription>Common tasks for your role</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2">
                    <a
                      href="/app/estimates/new"
                      className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <FileText className="h-5 w-5 text-primary" />
                      <span className="text-sm font-medium">Upload New Estimate</span>
                    </a>
                    <a
                      href="/app/customers"
                      className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <Users className="h-5 w-5 text-primary" />
                      <span className="text-sm font-medium">Manage Customers</span>
                    </a>
                    <a
                      href="/app/quotes"
                      className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <FileCheck className="h-5 w-5 text-primary" />
                      <span className="text-sm font-medium">View All Quotes</span>
                    </a>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        );

      case 'ops':
        return (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                title="Active Orders"
                value={activeOrders}
                description="In production/shipping"
                icon={Package}
                variant="accent"
              />
              <StatCard
                title="Pending Orders"
                value={orders.filter((o) => o.status === 'pending').length}
                description="Awaiting processing"
                icon={Clock}
                variant="warning"
              />
              <StatCard
                title="Shipped"
                value={orders.filter((o) => o.status === 'shipped').length}
                description="In transit"
                icon={TrendingUp}
                variant="success"
              />
              <StatCard
                title="Needs Attention"
                value={0}
                description="Hardware issues"
                icon={AlertCircle}
                variant="destructive"
              />
            </div>

            <div className="mt-8">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-xl">Order Pipeline</CardTitle>
                  <CardDescription>Orders requiring action</CardDescription>
                </CardHeader>
                <CardContent>
                  {orders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No orders yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {orders.slice(0, 5).map((order) => (
                        <div
                          key={order.id}
                          className="flex items-center justify-between rounded-lg border border-border p-3"
                        >
                          <div className="flex items-center gap-3">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">Order #{order.id.slice(-8)}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(order.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <OrderStatusBadge status={order.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        );

      case 'finance':
        return (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                title="Total Revenue"
                value="$0"
                description="This month"
                icon={DollarSign}
                variant="success"
              />
              <StatCard
                title="Pending Sync"
                value={0}
                description="QuickBooks items"
                icon={AlertCircle}
                variant="warning"
              />
              <StatCard
                title="Approved Quotes"
                value={quotes.filter((q) => q.status === 'approved').length}
                description="Ready to invoice"
                icon={FileCheck}
                variant="accent"
              />
              <StatCard
                title="Completed Orders"
                value={orders.filter((o) => o.status === 'completed').length}
                description="This month"
                icon={Package}
                variant="default"
              />
            </div>

            <div className="mt-8">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-xl">Financial Overview</CardTitle>
                  <CardDescription>QuickBooks sync status and pending items</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Connect QuickBooks to view financial sync status.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        );

      case 'admin':
      case 'hr':
        return (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                title="Total Users"
                value={4}
                description="Active accounts"
                icon={Users}
                variant="default"
              />
              <StatCard
                title="Customers"
                value={customers.length}
                description="In database"
                icon={Users}
                variant="accent"
              />
              <StatCard
                title="Total Quotes"
                value={quotes.length}
                description="All time"
                icon={FileCheck}
                variant="success"
              />
              <StatCard
                title="Total Orders"
                value={orders.length}
                description="All time"
                icon={Package}
                variant="warning"
              />
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-xl">System Overview</CardTitle>
                  <CardDescription>Administrative dashboard</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2">
                    <a
                      href="/app/admin/users"
                      className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <Users className="h-5 w-5 text-primary" />
                      <span className="text-sm font-medium">Manage Users</span>
                    </a>
                    <a
                      href="/app/admin/settings/integrations"
                      className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <TrendingUp className="h-5 w-5 text-primary" />
                      <span className="text-sm font-medium">Integrations</span>
                    </a>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-xl">Recent Activity</CardTitle>
                  <CardDescription>System-wide activity log</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    No recent activity to display.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-wide">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Welcome back, {user?.name}. Here's your overview.
        </p>
      </div>

      {roleBasedContent()}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number | string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'destructive';
}

function StatCard({ title, value, description, icon: Icon, variant = 'default' }: StatCardProps) {
  const iconColorClass = {
    default: 'text-primary',
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
  }[variant];

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-3xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <div className={`rounded-full bg-muted p-3 ${iconColorClass}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OcrStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    pending: 'secondary',
    processing: 'default',
    done: 'outline',
    error: 'destructive',
  };

  return (
    <Badge variant={variants[status] || 'default'} className="capitalize">
      {status}
    </Badge>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    pending: 'secondary',
    ordered: 'default',
    in_production: 'default',
    shipped: 'outline',
    completed: 'outline',
    cancelled: 'destructive',
  };

  const labels: Record<string, string> = {
    pending: 'Pending',
    ordered: 'Ordered',
    in_production: 'In Production',
    shipped: 'Shipped',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  return (
    <Badge variant={variants[status] || 'default'}>
      {labels[status] || status}
    </Badge>
  );
}
