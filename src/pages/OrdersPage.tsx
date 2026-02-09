import { useState } from 'react';
import { Package, Search, MoreHorizontal, Truck, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { orderStorage, customerStorage } from '@/lib/storage';
import type { Order, OrderStatus } from '@/types';

export default function OrdersPage() {
  const [orders] = useState<Order[]>(orderStorage.getAll());
  const [searchQuery, setSearchQuery] = useState('');

  const customers = customerStorage.getAll();

  const getCustomerName = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || 'Unknown';
  };

  const filteredOrders = orders.filter((order) =>
    getCustomerName(order.customerId).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusConfig = (status: OrderStatus) => {
    const config: Record<OrderStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; icon: typeof Package }> = {
      pending: { variant: 'secondary', label: 'Pending', icon: Clock },
      ordered: { variant: 'default', label: 'Ordered', icon: Package },
      in_production: { variant: 'default', label: 'In Production', icon: Package },
      shipped: { variant: 'outline', label: 'Shipped', icon: Truck },
      completed: { variant: 'outline', label: 'Completed', icon: CheckCircle2 },
      cancelled: { variant: 'destructive', label: 'Cancelled', icon: XCircle },
    };
    return config[status];
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-wide">Orders</h1>
          <p className="mt-1 text-muted-foreground">
            Track order lifecycle from approval to delivery
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {(['pending', 'ordered', 'in_production', 'shipped', 'completed'] as OrderStatus[]).map((status) => {
          const config = getStatusConfig(status);
          const count = orders.filter((o) => o.status === status).length;
          return (
            <Card key={status}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{config.label}</p>
                    <p className="text-2xl font-semibold">{count}</p>
                  </div>
                  <div className="rounded-full bg-muted p-2">
                    <config.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Orders</CardTitle>
              <CardDescription>{orders.length} total orders</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Package className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No orders match your search' : 'No orders yet'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Orders are created when quotes are approved and converted
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Promised Ship</TableHead>
                    <TableHead className="hidden lg:table-cell">Created</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => {
                    const statusConfig = getStatusConfig(order.status);
                    return (
                      <TableRow key={order.id}>
                        <TableCell>
                          <span className="font-mono text-sm">
                            ORD-{order.id.slice(-6).toUpperCase()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">
                            {getCustomerName(order.customerId)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusConfig.variant}>
                            {statusConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {order.promisedShipDate
                            ? new Date(order.promisedShipDate).toLocaleDateString()
                            : '—'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <a href={`/app/orders/${order.id}`}>View Details</a>
                              </DropdownMenuItem>
                              <DropdownMenuItem>Update Status</DropdownMenuItem>
                              <DropdownMenuItem>Hardware Request</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem>Reorder</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
