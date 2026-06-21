import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AdminRoute } from "@/components/AdminRoute";

// ─── Lazy-loaded pages ────────────────────────────────────────────────────────
// Each route chunk is loaded on demand, cutting initial bundle by ~60%.

const Dashboard              = lazy(() => import("@/pages/Dashboard"));
const AuditLogPage           = lazy(() => import("@/pages/AuditLogPage"));
const UserManagementPage     = lazy(() => import("@/pages/UserManagementPage"));
const Investigations         = lazy(() => import("@/pages/Investigations"));
const InvestigationDetail    = lazy(() => import("@/pages/InvestigationDetail"));
const Reports                = lazy(() => import("@/pages/Reports"));
const Alerts                 = lazy(() => import("@/pages/Alerts"));
const Tenants                = lazy(() => import("@/pages/Tenants"));
const Settings               = lazy(() => import("@/pages/Settings"));
const NotFound               = lazy(() => import("@/pages/NotFound"));
const Forbidden              = lazy(() => import("@/pages/Forbidden"));
const SearchResults          = lazy(() => import("@/pages/SearchResults"));
const VerifyKYC              = lazy(() => import("@/pages/VerifyKYC"));

const BiometricEnrollmentPage   = lazy(() => import("@/pages/bis/BiometricEnrollmentPage"));
const BiometricSessionLogPage   = lazy(() => import("@/pages/bis/BiometricSessionLogPage"));
const FieldAgentsPage           = lazy(() => import("@/pages/bis/FieldAgentsPage"));
const DataSourcesPage           = lazy(() => import("@/pages/bis/DataSourcesPage"));
const ContinuousMonitoringPage  = lazy(() => import("@/pages/bis/ContinuousMonitoringPage"));
const DrugScreeningPage         = lazy(() => import("@/pages/bis/DrugScreeningPage"));
const MVRCheckPage              = lazy(() => import("@/pages/bis/MVRCheckPage"));
const NigerianDataBundlePage    = lazy(() => import("@/pages/bis/NigerianDataBundlePage"));
const WorkAuthorizationPage     = lazy(() => import("@/pages/bis/WorkAuthorizationPage"));
const ZeroFootprintPage         = lazy(() => import("@/pages/bis/ZeroFootprintPage"));

const BillingPage               = lazy(() => import("@/pages/bis/BillingPage"));
const PaymentRailsPage          = lazy(() => import("@/pages/PaymentRails"));
const AccountDetailPage          = lazy(() => import("@/pages/AccountDetail"));
const FrozenAccountsDashboard    = lazy(() => import("@/pages/FrozenAccountsDashboard"));
const BatchMonitorPage           = lazy(() => import("@/pages/BatchMonitor"));
const KYCVerificationPage       = lazy(() => import("@/pages/kyc/KYCVerificationPage"));
const KYCRecordsPage            = lazy(() => import("@/pages/kyc/KYCRecordsPage"));
const MessagingChannelsPage     = lazy(() => import("@/pages/messaging/MessagingChannelsPage"));
const SocialMonitoringDashboard = lazy(() => import("@/pages/monitoring/SocialMonitoringDashboard"));
const StakeholderOnboardingWizard = lazy(() => import("@/pages/onboarding/StakeholderOnboardingWizard"));
const OnboardingAdminPage         = lazy(() => import("@/pages/admin/OnboardingAdminPage"));
const UsersAdminPage              = lazy(() => import("@/pages/admin/UsersAdminPage"));
const DocumentReviewQueue         = lazy(() => import("@/pages/admin/DocumentReviewQueue"));
const PushSettingsPage             = lazy(() => import("@/pages/admin/PushSettingsPage"));
const ScreeningRecordsPage        = lazy(() => import("@/pages/screening/ScreeningRecordsPage"));
const AlertRulesPage               = lazy(() => import("@/pages/AlertRulesPage"));
const DeveloperPortal = lazy(() => import("./pages/DeveloperPortal"));
const QuickCheck = lazy(() => import("./pages/QuickCheck"));
const GoamlWizard = lazy(() => import("./pages/GoamlWizard"));
const TenantBrandingPage           = lazy(() => import("@/pages/TenantBrandingPage"));
const LakehouseAnalyticsPage       = lazy(() => import("@/pages/bis/LakehouseAnalyticsPage"));
const FieldAgentPlaybooksPage      = lazy(() => import("@/pages/bis/FieldAgentPlaybooksPage"));
const DuplicateIdentityCheckPage   = lazy(() => import("@/pages/bis/DuplicateIdentityCheckPage"));
const HostedVerificationLinksPage  = lazy(() => import("@/pages/bis/HostedVerificationLinksPage"));
const CasesPage                    = lazy(() => import("@/pages/bis/CasesPage"));
const CaseDetailPage               = lazy(() => import("@/pages/bis/CaseDetailPage"));
const StakeholderPortalPage        = lazy(() => import("@/pages/bis/StakeholderPortalPage"));
const StakeholderPortalLandingPage = lazy(() => import("@/pages/StakeholderPortalLandingPage"));
const OllamaManagementPage         = lazy(() => import("@/pages/bis/OllamaManagementPage"));

// LEX — Law Enforcement Extension
const LexAdminPage      = lazy(() => import("@/pages/lex/LexAdminPage"));
const LexSubmitPage     = lazy(() => import("@/pages/lex/LexSubmitPage"));
const LexReviewPage     = lazy(() => import("@/pages/lex/LexReviewPage"));
const LexAnalyticsPage  = lazy(() => import("@/pages/lex/LexAnalyticsPage"));
const LexSupervisorPage = lazy(() => import("@/pages/lex/LexSupervisorPage"));
// Settings sub-pages
const SessionsPage         = lazy(() => import("@/pages/settings/SessionsPage"));
const TwoFactorPage        = lazy(() => import("@/pages/settings/TwoFactorPage"));
const ExportSchedulesPage  = lazy(() => import("@/pages/settings/ExportSchedulesPage"));
// Platform sub-pages
const InvestigationCaseLinksPage = lazy(() => import("@/pages/InvestigationCaseLinksPage"));
const NotificationCentrePage     = lazy(() => import("@/pages/NotificationCentrePage"));
// Infrastructure
const KeycloakPage           = lazy(() => import("@/pages/infra/KeycloakPage"));
const GatewayHealthPage      = lazy(() => import("@/pages/infra/GatewayHealthPage"));
const TemporalPage           = lazy(() => import("@/pages/infra/TemporalPage"));
const RedisPage              = lazy(() => import("@/pages/infra/RedisPage"));
const SystemHealthDashboard  = lazy(() => import("@/pages/infra/SystemHealthDashboard"));
// Banking & Compliance
const AMLTransactionsPage        = lazy(() => import("@/pages/bis/AMLTransactionsPage"));
const SARFilingPage              = lazy(() => import("@/pages/bis/SARFilingPage"));
const TradeFinancePage           = lazy(() => import("@/pages/bis/TradeFinancePage"));
const CorrespondentBankingPage   = lazy(() => import("@/pages/bis/CorrespondentBankingPage"));
const EvidencePage               = lazy(() => import("@/pages/bis/EvidencePage"));
const RegulatoryReportsPage      = lazy(() => import("@/pages/bis/RegulatoryReportsPage"));
// New v62 pages
const DocumentVaultPage          = lazy(() => import("@/pages/DocumentVaultPage"));
const RiskDashboardPage          = lazy(() => import("@/pages/RiskDashboardPage"));
const TransferAnalyticsDashboard = lazy(() => import("@/pages/TransferAnalyticsDashboard"));
const ReconciliationReportPage   = lazy(() => import("@/pages/ReconciliationReportPage"));
// Insider Threat pages
const InsiderThreatDashboard     = lazy(() => import("@/pages/InsiderThreatDashboard"));
const UEBAProfilePage            = lazy(() => import("@/pages/UEBAProfilePage"));
const AccessReviewPanel          = lazy(() => import("@/pages/AccessReviewPanel"));

// ─── Page loading skeleton ────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Switch>
        {/* Core */}
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/investigations" component={Investigations} />
        <Route path="/investigations/:id" component={InvestigationDetail} />
        <Route path="/reports" component={Reports} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/tenants" component={Tenants} />
        <Route path="/settings" component={Settings} />
        <Route path="/audit-log" component={AuditLogPage} />
        <Route path="/users" component={UserManagementPage} />

        {/* BIS Feature Modules */}
        <Route path="/biometric-enrollment" component={BiometricEnrollmentPage} />
        <Route path="/biometric-sessions" component={BiometricSessionLogPage} />
        <Route path="/continuous-monitoring" component={ContinuousMonitoringPage} />
        <Route path="/drug-screening" component={DrugScreeningPage} />
        <Route path="/mvr-check" component={MVRCheckPage} />
        <Route path="/nigeria-data-bundle" component={NigerianDataBundlePage} />
        <Route path="/work-authorization" component={WorkAuthorizationPage} />
        <Route path="/zero-footprint" component={ZeroFootprintPage} />
        <Route path="/field-agents" component={FieldAgentsPage} />
        <Route path="/data-sources" component={DataSourcesPage} />
        <Route path="/billing" component={BillingPage} />
        <Route path="/payment-rails" component={PaymentRailsPage} />
        <Route path="/payment-rails/accounts/:accountId" component={AccountDetailPage} />
        <Route path="/payment-rails/frozen" component={FrozenAccountsDashboard} />
        <Route path="/payment-rails/batch-monitor" component={BatchMonitorPage} />

        {/* KYC / Onboarding / Intelligence */}
        <Route path="/kyc-verification" component={KYCVerificationPage} />
        <Route path="/kyc-records" component={KYCRecordsPage} />
        <Route path="/messaging-channels" component={MessagingChannelsPage} />
        <Route path="/social-monitoring" component={SocialMonitoringDashboard} />
        <Route path="/onboarding" component={StakeholderOnboardingWizard} />
        <Route path="/admin/onboarding" component={() => <AdminRoute><OnboardingAdminPage /></AdminRoute>} />
        <Route path="/admin/users" component={() => <AdminRoute><UsersAdminPage /></AdminRoute>} />
        <Route path="/admin/documents" component={() => <AdminRoute><DocumentReviewQueue /></AdminRoute>} />
        <Route path="/admin/settings/push" component={() => <AdminRoute><PushSettingsPage /></AdminRoute>} />
        <Route path="/screening-records" component={ScreeningRecordsPage} />
        <Route path="/alert-rules" component={AlertRulesPage} />
        <Route path="/developer" component={DeveloperPortal} />
        <Route path="/quickcheck" component={QuickCheck} />
        <Route path="/goaml" component={GoamlWizard} />
        <Route path="/lakehouse" component={LakehouseAnalyticsPage} />
        <Route path="/tenants/:id/settings" component={TenantBrandingPage} />
        <Route path="/playbooks" component={FieldAgentPlaybooksPage} />
        <Route path="/duplicate-check" component={DuplicateIdentityCheckPage} />
        <Route path="/hosted-links" component={HostedVerificationLinksPage} />
        <Route path="/cases" component={CasesPage} />
        <Route path="/cases/portal" component={StakeholderPortalPage} />
        <Route path="/stakeholder-portal" component={StakeholderPortalLandingPage} />
        <Route path="/cases/:ref" component={CaseDetailPage} />
        <Route path="/ollama" component={OllamaManagementPage} />
        {/* LEX — Law Enforcement Extension */}
        <Route path="/lex/submit" component={LexSubmitPage} />
        <Route path="/lex/admin" component={() => <AdminRoute><LexAdminPage /></AdminRoute>} />
        <Route path="/lex/review" component={LexReviewPage} />
        <Route path="/lex/analytics" component={LexAnalyticsPage} />
        <Route path="/lex/supervisor" component={LexSupervisorPage} />

        {/* Settings sub-pages */}
        <Route path="/settings/sessions" component={SessionsPage} />
        <Route path="/settings/2fa" component={TwoFactorPage} />
        <Route path="/settings/export-schedules" component={ExportSchedulesPage} />
        {/* Platform sub-pages */}
        <Route path="/investigation-links" component={InvestigationCaseLinksPage} />
        <Route path="/notifications" component={NotificationCentrePage} />
        <Route path="/aml-transactions" component={AMLTransactionsPage} />
        <Route path="/sar-filings" component={SARFilingPage} />
        <Route path="/trade-finance" component={TradeFinancePage} />
        <Route path="/correspondent-banking" component={CorrespondentBankingPage} />
        <Route path="/evidence" component={EvidencePage} />
        <Route path="/regulatory-reports" component={RegulatoryReportsPage} />
        {/* v62 New Pages */}
        <Route path="/document-vault" component={DocumentVaultPage} />
        <Route path="/risk-dashboard" component={RiskDashboardPage} />
        {/* Insider Threat */}
        <Route path="/insider-threat" component={InsiderThreatDashboard} />
        <Route path="/insider-threat/ueba" component={UEBAProfilePage} />
        <Route path="/insider-threat/access-reviews" component={AccessReviewPanel} />
        <Route path="/payment-rails/analytics" component={TransferAnalyticsDashboard} />
        <Route path="/payment-rails/reconciliation" component={ReconciliationReportPage} />
        {/* Infrastructure */}
        <Route path="/infra/keycloak" component={KeycloakPage} />
        <Route path="/infra/temporal" component={TemporalPage} />
        <Route path="/infra/redis" component={RedisPage} />
        <Route path="/infra/gateway" component={GatewayHealthPage} />
        <Route path="/infra/health" component={SystemHealthDashboard} />
        {/* Fallback */}
        <Route path="/verify/:token" component={VerifyKYC} />
        <Route path="/search" component={SearchResults} />
        <Route path="/403" component={Forbidden} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable={true}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
