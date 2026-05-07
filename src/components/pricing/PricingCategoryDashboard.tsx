import { DoorOpen, Square, Wrench, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface PricingCategoryDashboardProps {
  onSelectDoors: () => void;
}

export function PricingCategoryDashboard({ onSelectDoors }: PricingCategoryDashboardProps) {
  const { toast } = useToast();

  function handleComingSoon(category: string) {
    toast({
      title: `${category} Pricing — Coming Soon`,
      description: 'This category will be available in a future release.',
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage pricing tables for each product category. Select a category to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Doors — active */}
        <button
          onClick={onSelectDoors}
          className="group relative flex flex-col gap-4 rounded-2xl border bg-card p-6 text-left shadow-sm hover:border-primary hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-primary/10 p-3">
              <DoorOpen className="h-6 w-6 text-primary" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Doors</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage door pricing tables by series, dimensions, gauge, and material.
            </p>
          </div>
          <div className="mt-auto">
            <Button size="sm" className="gap-1.5 w-full" tabIndex={-1} asChild>
              <span>
                Manage Pricing
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Button>
          </div>
        </button>

        {/* Frames — coming soon */}
        <div className="relative flex flex-col gap-4 rounded-2xl border bg-card/60 p-6 opacity-60 cursor-not-allowed select-none">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-muted p-3">
              <Square className="h-6 w-6 text-muted-foreground" />
            </div>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              Coming Soon
            </Badge>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-muted-foreground">Frames</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pricing tables for frame types, profiles, and configurations.
            </p>
          </div>
          <div className="mt-auto">
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 w-full"
              disabled
              onClick={() => handleComingSoon('Frames')}
            >
              Coming Soon
            </Button>
          </div>
        </div>

        {/* Hardware — coming soon */}
        <div className="relative flex flex-col gap-4 rounded-2xl border bg-card/60 p-6 opacity-60 cursor-not-allowed select-none">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-muted p-3">
              <Wrench className="h-6 w-6 text-muted-foreground" />
            </div>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              Coming Soon
            </Badge>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-muted-foreground">Hardware</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pricing tables for hardware catalog items and accessories.
            </p>
          </div>
          <div className="mt-auto">
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 w-full"
              disabled
              onClick={() => handleComingSoon('Hardware')}
            >
              Coming Soon
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
