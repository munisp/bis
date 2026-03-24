import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

// Core pages
import Dashboard from "@/pages/Dashboard";
import AuditLogPage from "@/pages/AuditLogPage";
import Investigations from "@/pages/Investigations";
import InvestigationDetail from "@/pages/InvestigationDetail";
import Reports from "@/pages/Reports";
import Alerts from "@/pages/Alerts";
import Tenants from "@/pages/Tenants";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/NotFound";

// BIS feature pages
import BiometricEnrollmentPage from "@/pages/bis/BiometricEnrollmentPage";
import FieldAgentsPage from "@/pages/bis/FieldAgentsPage";
import DataSourcesPage from "@/pages/bis/DataSourcesPage";
import ContinuousMonitoringPage from "@/pages/bis/ContinuousMonitoringPage";
import DrugScreeningPage from "@/pages/bis/DrugScreeningPage";
import MVRCheckPage from "@/pages/bis/MVRCheckPage";
import NigerianDataBundlePage from "@/pages/bis/NigerianDataBundlePage";
import WorkAuthorizationPage from "@/pages/bis/WorkAuthorizationPage";
import ZeroFootprintPage from "@/pages/bis/ZeroFootprintPage";

// KYC / Onboarding / Monitoring
import KYCVerificationPage from "@/pages/kyc/KYCVerificationPage";
import MessagingChannelsPage from "@/pages/messaging/MessagingChannelsPage";
import SocialMonitoringDashboard from "@/pages/monitoring/SocialMonitoringDashboard";
import StakeholderOnboardingWizard from "@/pages/onboarding/StakeholderOnboardingWizard";

function Router() {
  return (
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

      {/* BIS Feature Modules */}
      <Route path="/biometric-enrollment" component={BiometricEnrollmentPage} />
      <Route path="/continuous-monitoring" component={ContinuousMonitoringPage} />
      <Route path="/drug-screening" component={DrugScreeningPage} />
      <Route path="/mvr-check" component={MVRCheckPage} />
      <Route path="/nigeria-data-bundle" component={NigerianDataBundlePage} />
      <Route path="/work-authorization" component={WorkAuthorizationPage} />
      <Route path="/zero-footprint" component={ZeroFootprintPage} />
      <Route path="/field-agents" component={FieldAgentsPage} />
      <Route path="/data-sources" component={DataSourcesPage} />

      {/* KYC / Onboarding / Intelligence */}
      <Route path="/kyc-verification" component={KYCVerificationPage} />
      <Route path="/messaging-channels" component={MessagingChannelsPage} />
      <Route path="/social-monitoring" component={SocialMonitoringDashboard} />
      <Route path="/onboarding" component={StakeholderOnboardingWizard} />

      {/* Fallback */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

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
