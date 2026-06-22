import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { PricingTableLibrary } from '@/components/pricing/PricingTableLibrary';
import { DoorSeriesList } from '@/components/pricing/DoorSeriesList';
import { FrameSeriesList } from '@/components/pricing/FrameSeriesList';
import { SeriesMultiTableEditor } from '@/components/pricing/SeriesMultiTableEditor';
import { LitesLouversGlassList } from '@/components/pricing/LitesLouversGlassList';
import { LitesLouversGlassItemEditor } from '@/components/pricing/LitesLouversGlassItemEditor';
import { SimpleGridEditor } from '@/components/pricing/SimpleGridEditor';
import { PricingTableEditor } from '@/components/pricing/PricingTableEditor';

export default function PricingPage() {
  const { seriesValue, itemCode, tableId } = useParams<{ seriesValue?: string; itemCode?: string; tableId?: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith('/app/pricing/tables') ? '/app/pricing/tables' : '/app/pricing';
  const backToPricing = () => navigate('/app/pricing');

  // /app/pricing/tables/doors/:seriesValue and legacy /app/pricing/doors/:seriesValue.
  if (pathname.startsWith(`${basePath}/doors/`) && seriesValue) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <SeriesMultiTableEditor
          seriesValue={seriesValue}
          initialTableId={tableId}
          category="doors"
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables/doors and legacy /app/pricing/doors.
  if (pathname.startsWith(`${basePath}/doors`)) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-5xl mx-auto w-full">
        <DoorSeriesList
          onSelectSeries={(sv) => navigate(`${basePath}/doors/${encodeURIComponent(sv)}`)}
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables/frames/:seriesValue and legacy /app/pricing/frames/:seriesValue.
  if (pathname.startsWith(`${basePath}/frames/`) && seriesValue) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <SeriesMultiTableEditor
          seriesValue={seriesValue}
          initialTableId={tableId}
          category="frames"
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables/frames and legacy /app/pricing/frames.
  if (pathname.startsWith(`${basePath}/frames`)) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-5xl mx-auto w-full">
        <FrameSeriesList
          onSelectSeries={(sv) => navigate(`${basePath}/frames/${encodeURIComponent(sv)}`)}
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables/lites_louvers_glass/table/:tableId and legacy equivalent.
  if (pathname.includes(`${basePath}/lites_louvers_glass/table/`) && tableId) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <SimpleGridEditor
          tableId={tableId}
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables/lites_louvers_glass/:itemCode and legacy equivalent.
  if (pathname.startsWith(`${basePath}/lites_louvers_glass/`) && itemCode) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <LitesLouversGlassItemEditor
          canonicalCode={itemCode}
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables/lites_louvers_glass and legacy equivalent.
  if (pathname.startsWith(`${basePath}/lites_louvers_glass`)) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-5xl mx-auto w-full">
        <LitesLouversGlassList
          onSelectTable={(id) => navigate(`${basePath}/lites_louvers_glass/table/${id}`)}
          onSelectItem={(code) => navigate(`${basePath}/lites_louvers_glass/${encodeURIComponent(code)}`)}
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables/table/:tableId opens a table directly from the library.
  if (pathname.startsWith(`${basePath}/table/`) && tableId) {
    return (
      <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
        <PricingTableEditor
          tableId={tableId}
          seriesValue={seriesValue ?? ''}
          onBack={backToPricing}
        />
      </div>
    );
  }

  // /app/pricing/tables → visual table library. Legacy /app/pricing deep links
  // still reach the category paths above, but exact /app/pricing is now the hub.
  return (
    <div className="flex flex-col min-h-full p-6 max-w-7xl mx-auto w-full">
      <PricingTableLibrary
        onBack={backToPricing}
        onOpenDefaults={() => navigate('/app/pricing/defaults')}
        onOpenIngestion={() => navigate('/app/pricing/ingest')}
        onOpenQa={() => navigate('/app/pricing/qa')}
        onOpenRuleTable={(priceTableId) => navigate(`/app/pricing/tables/engine/${priceTableId}`)}
        onSelectCategory={(slug) => navigate(`${basePath}/${slug}`)}
        onSelectTable={(table) => {
          if (table.category === 'doors' || table.category === 'frames') {
            navigate(`${basePath}/${table.category}/${encodeURIComponent(table.seriesValue)}/table/${table.id}`);
            return;
          }
          if (table.category === 'lites_louvers_glass') {
            navigate(`${basePath}/lites_louvers_glass/table/${table.id}`);
            return;
          }
          navigate(`${basePath}/table/${table.id}`);
        }}
      />
    </div>
  );
}
