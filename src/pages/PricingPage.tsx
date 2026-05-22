import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { PricingCategoryDashboard } from '@/components/pricing/PricingCategoryDashboard';
import { DoorSeriesList } from '@/components/pricing/DoorSeriesList';
import { FrameSeriesList } from '@/components/pricing/FrameSeriesList';
import { SeriesMultiTableEditor } from '@/components/pricing/SeriesMultiTableEditor';
import { LitesLouversGlassList } from '@/components/pricing/LitesLouversGlassList';
import { LitesLouversGlassItemEditor } from '@/components/pricing/LitesLouversGlassItemEditor';
import { SimpleGridEditor } from '@/components/pricing/SimpleGridEditor';

export default function PricingPage() {
  const { seriesValue, itemCode, tableId } = useParams<{ seriesValue?: string; itemCode?: string; tableId?: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // /app/pricing/doors/:seriesValue → multi-table editor for this series
  if (pathname.startsWith('/app/pricing/doors/') && seriesValue) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <SeriesMultiTableEditor
          seriesValue={seriesValue}
          category="doors"
          onBack={() => navigate('/app/pricing/doors')}
        />
      </div>
    );
  }

  // /app/pricing/doors → series list
  if (pathname.startsWith('/app/pricing/doors')) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-5xl mx-auto w-full">
        <DoorSeriesList
          onSelectSeries={(sv) => navigate(`/app/pricing/doors/${sv}`)}
          onBack={() => navigate('/app/pricing')}
        />
      </div>
    );
  }

  // /app/pricing/frames/:seriesValue → multi-table editor for this frame series
  if (pathname.startsWith('/app/pricing/frames/') && seriesValue) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <SeriesMultiTableEditor
          seriesValue={seriesValue}
          category="frames"
          onBack={() => navigate('/app/pricing/frames')}
        />
      </div>
    );
  }

  // /app/pricing/frames → frame series list
  if (pathname.startsWith('/app/pricing/frames')) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-5xl mx-auto w-full">
        <FrameSeriesList
          onSelectSeries={(sv) => navigate(`/app/pricing/frames/${sv}`)}
          onBack={() => navigate('/app/pricing')}
        />
      </div>
    );
  }

  // /app/pricing/lites_louvers_glass/table/:tableId → direct grid editor
  if (pathname.includes('/app/pricing/lites_louvers_glass/table/') && tableId) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <SimpleGridEditor
          tableId={tableId}
          onBack={() => navigate('/app/pricing/lites_louvers_glass')}
        />
      </div>
    );
  }

  // /app/pricing/lites_louvers_glass/:itemCode → item-based editor (create or open 1:1 table)
  if (pathname.startsWith('/app/pricing/lites_louvers_glass/') && itemCode) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <LitesLouversGlassItemEditor
          canonicalCode={itemCode}
          onBack={() => navigate('/app/pricing/lites_louvers_glass')}
        />
      </div>
    );
  }

  // /app/pricing/lites_louvers_glass → grouped item list
  if (pathname.startsWith('/app/pricing/lites_louvers_glass')) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-5xl mx-auto w-full">
        <LitesLouversGlassList
          onSelectTable={(id) => navigate(`/app/pricing/lites_louvers_glass/table/${id}`)}
          onSelectItem={(code) => navigate(`/app/pricing/lites_louvers_glass/${encodeURIComponent(code)}`)}
          onBack={() => navigate('/app/pricing')}
        />
      </div>
    );
  }

  // /app/pricing → category dashboard
  return (
    <div className="flex flex-col min-h-full p-6 max-w-4xl mx-auto w-full">
      <PricingCategoryDashboard
        onSelectCategory={(slug) => navigate(`/app/pricing/${slug}`)}
      />
    </div>
  );
}
