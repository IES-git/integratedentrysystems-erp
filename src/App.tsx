import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import { RoleGuard } from "@/components/auth/RoleGuard";
import LoginPage from "@/pages/LoginPage";
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import PublicQuoteApprovalPage from "@/pages/PublicQuoteApprovalPage";
import DashboardPage from "@/pages/DashboardPage";
import CustomersPage from "@/pages/CustomersPage";
import CompanyDetailPage from "@/pages/CompanyDetailPage";
import ManufacturersPage from "@/pages/ManufacturersPage";
import EstimatesListPage from "@/pages/EstimatesListPage";
import EstimateUploadPage from "@/pages/EstimateUploadPage";
import EstimateWizardPage from "@/pages/EstimateWizardPage";
import ManualEstimateWizardPage from "@/pages/ManualEstimateWizardPage";
import NewOpeningPage from "@/pages/NewOpeningPage";
import SpecOpeningPage from "@/pages/SpecOpeningPage";
import QuotesPage from "@/pages/QuotesPage";
import QuoteWizardPage from "@/pages/QuoteWizardPage";
import QuoteBuilderPage from "@/pages/QuoteBuilderPage";
import QuoteDetailPage from "@/pages/QuoteDetailPage";
import OrdersPage from "@/pages/OrdersPage";
import TemplatesPage from "@/pages/TemplatesPage";
import TemplateDetailPage from "@/pages/TemplateDetailPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import AdminIntegrationsPage from "@/pages/AdminIntegrationsPage";
import ItemManagementPage from "@/pages/ItemManagementPage";
import ItemManagementProgressivePage from "@/pages/ItemManagementProgressivePage";
import PricingHubPage from "@/pages/PricingHubPage";
import PricingPage from "@/pages/PricingPage";
import PricingDefaultsPage from "@/pages/PricingDefaultsPage";
import PricingRuleTableDetailPage from "@/pages/PricingRuleTableDetailPage";
import PriceBookIngestPage from "@/pages/PriceBookIngestPage";
import QaDashboardPage from "@/pages/QaDashboardPage";
import CompatibilityRulesPage from "@/pages/CompatibilityRulesPage";
import HelpGuidePage from "@/pages/HelpGuidePage";
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

                {/* Public auth routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/quote-approval/:token" element={<PublicQuoteApprovalPage />} />

                {/* Protected app routes — AppLayout enforces authentication */}
                <Route path="/app" element={<AppLayout />}>
                  {/* Main — accessible to all roles */}
                  <Route index element={<DashboardPage />} />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="customers/:id" element={<CompanyDetailPage />} />
                  <Route path="manufacturers" element={<ManufacturersPage />} />
                  <Route path="manufacturers/:id" element={<CompanyDetailPage />} />
                  <Route path="estimates" element={<EstimatesListPage />} />
                  <Route path="estimates/new" element={<EstimateUploadPage />} />
                  <Route path="estimates/create" element={<ManualEstimateWizardPage />} />
                  <Route path="estimates/:estimateId/edit" element={<ManualEstimateWizardPage />} />
                  <Route path="estimates/:estimateId/review" element={<ManualEstimateWizardPage />} />
                  <Route path="estimates/wizard" element={<EstimateWizardPage />} />
                  <Route path="estimates/openings/new" element={<NewOpeningPage />} />
                  <Route path="estimates/:estimateId/openings/new" element={<NewOpeningPage />} />
                  <Route path="estimates/openings/build" element={<SpecOpeningPage />} />
                  <Route path="estimates/:estimateId/openings/build" element={<SpecOpeningPage />} />
                  <Route path="quotes" element={<QuotesPage />} />
                  <Route path="quotes/wizard" element={<QuoteWizardPage />} />
                  <Route path="quotes/new" element={<QuoteBuilderPage />} />
                  <Route path="quotes/:id/edit" element={<QuoteBuilderPage />} />
                  <Route path="quotes/:id" element={<QuoteDetailPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="templates" element={<TemplatesPage />} />
                  <Route path="templates/:id" element={<TemplateDetailPage />} />
                  <Route path="help" element={<HelpGuidePage />} />

                  {/* Admin + Ops — accessible to admin and ops only */}
                  <Route
                    path="pricing/ingest"
                    element={<RoleGuard roles={['admin', 'ops']}><PriceBookIngestPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/qa"
                    element={<RoleGuard roles={['admin', 'ops']}><QaDashboardPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingHubPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/defaults"
                    element={<RoleGuard roles={['admin']}><PricingDefaultsPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/table/:tableId"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/engine/:priceTableId"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingRuleTableDetailPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/doors"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/doors/:seriesValue"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/doors/:seriesValue/table/:tableId"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/frames"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/frames/:seriesValue"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/frames/:seriesValue/table/:tableId"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/lites_louvers_glass"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/lites_louvers_glass/table/:tableId"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/tables/lites_louvers_glass/:itemCode"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/doors"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/doors/:seriesValue"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/frames"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/frames/:seriesValue"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/lites_louvers_glass"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/lites_louvers_glass/table/:tableId"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="pricing/lites_louvers_glass/:itemCode"
                    element={<RoleGuard roles={['admin', 'ops']}><PricingPage /></RoleGuard>}
                  />
                  <Route
                    path="items"
                    element={<RoleGuard roles={['admin', 'ops']}><ItemManagementPage /></RoleGuard>}
                  />
                  <Route
                    path="item-management"
                    element={<RoleGuard roles={['admin', 'ops']}><ItemManagementProgressivePage /></RoleGuard>}
                  />
                  <Route
                    path="admin/compatibility-rules"
                    element={<RoleGuard roles={['admin', 'ops']}><CompatibilityRulesPage /></RoleGuard>}
                  />
                  <Route
                    path="admin/settings/integrations"
                    element={<RoleGuard roles={['admin', 'ops']}><AdminIntegrationsPage /></RoleGuard>}
                  />

                  {/* Admin only */}
                  <Route
                    path="admin/users"
                    element={<RoleGuard roles={['admin']}><AdminUsersPage /></RoleGuard>}
                  />
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
