import { useState } from 'react';
import { CategoryDashboard } from '@/components/items/CategoryDashboard';
import { CategoryFieldsWizard } from '@/components/items/CategoryFieldsWizard';

type View = 'dashboard' | { slug: string; name: string };

export default function ItemManagementProgressivePage() {
  const [view, setView] = useState<View>('dashboard');

  return (
    <div className="flex flex-col min-h-full p-6 max-w-4xl mx-auto w-full">
      {view === 'dashboard' ? (
        <CategoryDashboard onSelectCategory={(slug, name) => setView({ slug, name })} />
      ) : (
        <CategoryFieldsWizard
          slug={view.slug}
          name={view.name}
          onBack={() => setView('dashboard')}
        />
      )}
    </div>
  );
}
