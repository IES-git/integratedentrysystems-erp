import { Outlet, Navigate } from 'react-router-dom';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { useAuth } from '@/contexts/AuthContext';
import iesLogoIcon from '@/assets/ies-logo-icon.png';

export function AppLayout() {
  const { user, isLoading } = useAuth();

  console.log('AppLayout render:', { isLoading, hasUser: !!user });

  if (isLoading) {
    console.log('AppLayout: Showing loading state');
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    console.log('AppLayout: No user, redirecting to login');
    return <Navigate to="/login" replace />;
  }

  console.log('AppLayout: Rendering app with sidebar');

  return (
      <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0 overflow-hidden">
          {/* Mobile-only sticky header with sidebar trigger */}
          <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
            <SidebarTrigger className="-ml-1" />
            <img src={iesLogoIcon} alt="IES" className="h-6 w-auto" />
          </header>
          <main className="flex-1 min-h-0 overflow-auto">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
