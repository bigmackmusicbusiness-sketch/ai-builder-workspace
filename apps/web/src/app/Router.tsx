// apps/web/src/app/Router.tsx — TanStack Router v1 route definitions.
// Shell is the root layout; individual screens mount via <Outlet />.
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { Shell }                    from './Shell';
import { Workspace }                from '../layout/MainWorkspace/Workspace';
import { EnvSecretsScreen }         from '../screens/EnvSecretsScreen';
import { JobsQueuesScreen }         from '../screens/JobsQueuesScreen';
import { DatabaseSchemaScreen }     from '../screens/DatabaseSchemaScreen';
import { ProviderSettingsScreen }   from '../screens/ProviderSettingsScreen';
import { AppSettingsScreen }        from '../screens/AppSettingsScreen';
import { ApprovalsScreen }          from '../screens/ApprovalsScreen';
import { OnboardingAutomationScreen } from '../screens/OnboardingAutomationScreen';
import { LogsHealthScreen }         from '../screens/LogsHealthScreen';
import { ProjectsScreen }           from '../screens/ProjectsScreen';
import { PublishScreen }            from '../screens/PublishScreen';
import { IntegrationsScreen }       from '../screens/IntegrationsScreen';
import { AgentRunsScreen }          from '../screens/AgentRunsScreen';
import { VersionsScreen }           from '../screens/VersionsScreen';
import { AssetsScreen }             from '../screens/AssetsScreen';
import { TemplatesScreen }          from '../screens/TemplatesScreen';

// Root route — renders Shell which includes TopBar, LeftPanel, and <Outlet />
const rootRoute = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

// Main workspace (default view)
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Workspace,
});

// Project management
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsScreen,
});

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  component: TemplatesScreen,
});

const agentRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs',
  component: AgentRunsScreen,
});

const versionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/versions',
  component: VersionsScreen,
});

const assetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assets',
  component: AssetsScreen,
});

// Publish & integrations
const publishRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/publish',
  component: PublishScreen,
});

const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations',
  component: IntegrationsScreen,
});

// Backend / infrastructure screens
const envSecretsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/env-secrets',
  component: EnvSecretsScreen,
});

const jobsQueuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs',
  component: JobsQueuesScreen,
});

const databaseSchemaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/database',
  component: DatabaseSchemaScreen,
});

const providerSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/providers',
  component: ProviderSettingsScreen,
});

const appSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: AppSettingsScreen,
});

const approvalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/approvals',
  component: ApprovalsScreen,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingAutomationScreen,
});

const logsHealthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsHealthScreen,
});

const routeTree = rootRoute.addChildren([
  workspaceRoute,
  projectsRoute,
  templatesRoute,
  agentRunsRoute,
  versionsRoute,
  assetsRoute,
  publishRoute,
  integrationsRoute,
  envSecretsRoute,
  jobsQueuesRoute,
  databaseSchemaRoute,
  providerSettingsRoute,
  appSettingsRoute,
  approvalsRoute,
  onboardingRoute,
  logsHealthRoute,
]);

export const router = createRouter({ routeTree });

// Type-safe router augmentation for IDE support
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
