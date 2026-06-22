import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardCheck,
  FileSpreadsheet,
  Lock,
  SlidersHorizontal,
  Table2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface PricingDestination {
  title: string;
  description: string;
  href: string;
  icon: typeof Table2;
  adminOnly?: boolean;
}

const destinations: PricingDestination[] = [
  {
    title: 'Pricing Tables',
    description: 'Browse existing pricing tables by manufacturer and update table data.',
    href: '/app/pricing/tables',
    icon: Table2,
  },
  {
    title: 'Price Book Ingestion',
    description: 'Upload and review source price books before publishing extracted tables.',
    href: '/app/pricing/ingest',
    icon: FileSpreadsheet,
  },
  {
    title: 'Price Book QA',
    description: 'Review price book quality checks, blocking issues, and coverage status.',
    href: '/app/pricing/qa',
    icon: ClipboardCheck,
  },
  {
    title: 'Pricing Defaults',
    description: 'Manage default markup, services, freight, and tax numbers.',
    href: '/app/pricing/defaults',
    icon: SlidersHorizontal,
    adminOnly: true,
  },
];

export default function PricingHubPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="flex min-h-full w-full flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Pricing</h1>
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
            Admin
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose where to work: table maintenance, price book intake, QA, or default pricing numbers.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {destinations.map((destination) => {
          const disabled = destination.adminOnly && !isAdmin;
          const Icon = destination.icon;
          const content = (
            <Card
              className={cn(
                'h-full transition-all',
                disabled
                  ? 'bg-muted/40 opacity-70'
                  : 'hover:border-primary hover:shadow-md focus-within:ring-2 focus-within:ring-primary',
              )}
            >
              <CardContent className="flex h-full flex-col gap-5 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-md bg-primary/10 p-2.5">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  {disabled ? (
                    <Lock className="mt-1 h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  )}
                </div>

                <div className="space-y-1">
                  <h2 className="text-base font-semibold">{destination.title}</h2>
                  <p className="text-sm leading-5 text-muted-foreground">{destination.description}</p>
                </div>

                <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
                  <span>{disabled ? 'Admin only' : 'Open'}</span>
                  {destination.adminOnly && <Badge variant="outline">Admin</Badge>}
                </div>
              </CardContent>
            </Card>
          );

          if (disabled) {
            return (
              <div key={destination.href} aria-disabled="true">
                {content}
              </div>
            );
          }

          return (
            <Link key={destination.href} to={destination.href} className="group block h-full focus:outline-none">
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
