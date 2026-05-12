import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { PricingCategoryDashboard } from '@/components/pricing/PricingCategoryDashboard';
import { DoorSeriesList } from '@/components/pricing/DoorSeriesList';
import { SeriesMultiTableEditor } from '@/components/pricing/SeriesMultiTableEditor';

export default function PricingPage() {
  const { seriesValue } = useParams<{ seriesValue?: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // /app/pricing/doors/:seriesValue → multi-table editor for this series
  if (seriesValue) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <SeriesMultiTableEditor
          seriesValue={seriesValue}
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

  // /app/pricing → category dashboard
  return (
    <div className="flex flex-col min-h-full p-6 max-w-4xl mx-auto w-full">
      <PricingCategoryDashboard
        onSelectCategory={(slug) => navigate(`/app/pricing/${slug}`)}
      />
    </div>
  );
}
