import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import LoginPage from "@/pages/LoginPage";
import SignUpPage from "@/pages/SignUpPage";
import DashboardPage from "@/pages/DashboardPage";
import CustomersPage from "@/pages/CustomersPage";
import CompanyDetailPage from "@/pages/CompanyDetailPage";
import ManufacturersPage from "@/pages/ManufacturersPage";
import EstimatesListPage from "@/pages/EstimatesListPage";
import EstimateUploadPage from "@/pages/EstimateUploadPage";
import EstimateWizardPage from "@/pages/EstimateWizardPage";
import QuotesPage from "@/pages/QuotesPage";
import QuoteWizardPage from "@/pages/QuoteWizardPage";
import OrdersPage from "@/pages/OrdersPage";
import TemplatesPage from "@/pages/TemplatesPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import AdminIntegrationsPage from "@/pages/AdminIntegrationsPage";
import AdminFieldDefinitionsPage from "@/pages/AdminFieldDefinitionsPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                {/* Redirect root to app dashboard */}
                <Route path="/" element={<Navigate to="/app" replace />} />
              
              {/* Auth routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignUpPage />} />
              
              {/* Protected app routes */}
              <Route path="/app" element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                
                {/* Customers */}
                <Route path="customers" element={<CustomersPage />} />
                <Route path="customers/:id" element={<CompanyDetailPage />} />
                
                {/* Manufacturers */}
                <Route path="manufacturers" element={<ManufacturersPage />} />
                
                {/* Estimates */}
                <Route path="estimates" element={<EstimatesListPage />} />
                <Route path="estimates/new" element={<EstimateUploadPage />} />
                <Route path="estimates/wizard" element={<EstimateWizardPage />} />
                
                {/* Quotes */}
                <Route path="quotes" element={<QuotesPage />} />
                <Route path="quotes/wizard" element={<QuoteWizardPage />} />
                
                {/* Orders */}
                <Route path="orders" element={<OrdersPage />} />
                
                {/* Templates */}
                <Route path="templates" element={<TemplatesPage />} />
                
                {/* Admin */}
                <Route path="admin/users" element={<AdminUsersPage />} />
                <Route path="admin/field-definitions" element={<AdminFieldDefinitionsPage />} />
                <Route path="admin/settings/integrations" element={<AdminIntegrationsPage />} />
              </Route>

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
