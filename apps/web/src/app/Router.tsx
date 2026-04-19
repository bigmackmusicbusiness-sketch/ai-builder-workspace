// apps/web/src/app/Router.tsx — TanStack Router v1 route definitions.
//
// Layout:
//   rootRoute           bare <Outlet /> — no Shell, no auth guard
//   ├── loginRoute      /login  → LoginScreen (public)
//   └── shellRoute      layout route — enforces auth, wraps content in Shell
//         ├── workspaceRoute  /
//         ├── projectsRoute   /projects
//         └── … all other authenticated routes

import {
  createRootRoute, createRoute, createRouter,
  Outlet, redirect,
} from '@tanstack/react-router';

import { Shell }                      from './Shell';
import { LoginScreen }                from '../screens/LoginScreen';
import { Workspace }                  from '../layout/MainWorkspace/Workspace';
import { EnvSecretsScreen }           from '../screens/EnvSecretsScreen';
import { JobsQueuesScreen }           from '../screens/JobsQueuesScreen';
import { DatabaseSchemaScreen }       from '../screens/DatabaseSchemaScreen';
import { ProviderSettingsScreen }     from '../screens/ProviderSettingsScreen';
import { AppSettingsScreen }          from '../screens/AppSettingsScreen';
import { ApprovalsScreen }            from '../screens/ApprovalsScreen';
import { OnboardingAutomationScreen } from '../screens/OnboardingAutomationScreen';
import { LogsHealthScreen }           from '../screens/LogsHealthScreen';
import { ProjectsScreen }             from '../screens/ProjectsScreen';
import { PublishScreen }              from '../screens/PublishScreen';
import { IntegrationsScreen }         from '../screens/IntegrationsScreen';
import { AgentRunsScreen }            from '../screens/AgentRunsScreen';
import { VersionsScreen }             from '../screens/VersionsScreen';
import { AssetsScreen }               from '../screens/AssetsScreen';
import { TemplatesScreen }            from '../screens/TemplatesScreen';
import { useAuthStore }               from '../lib/store/authStore';

// ── Root — bare outlet, no layout ────────────────────────────────────
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// ── Login — public, no Shell ──────────────────────────────────────────
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginScreen,
});

// ── Shell layout — auth-gated, wraps all authenticated routes ─────────
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',

  beforeLoad: async ({ location }) => {
    // Wait for the auth store to finish hydrating (getSession is async)
    const store = useAuthStore.getState();
    if (store.loading) {
      await new Promise<void>((resolve) => {
        const unsub = useAuthStore.subscribe((s) => {
          if (!s.loading) { unsub(); resolve(); }
        });
      });
    }

    if (!useAuthStore.getState().session) {
      throw redirect({
        to: '/login',
        search: { redirect: location.pathname },
      });
    }
  },

  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

// ── Authenticated routes (all under shellRoute) ───────────────────────
const workspaceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: Workspace,
});

const projectsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects',
  component: ProjectsScreen,
});

const templatesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/templates',
  component: TemplatesScreen,
});

const agentRunsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/runs',
  component: AgentRunsScreen,
});

const versionsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/versions',
  component: VersionsScreen,
});

const assetsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/assets',
  component: AssetsScreen,
});

const publishRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/publish',
  component: PublishScreen,
});

const integrationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/integrations',
  component: IntegrationsScreen,
});

const envSecretsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/env-secrets',
  component: EnvSecretsScreen,
});

const jobsQueuesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/jobs',
  component: JobsQueuesScreen,
});

const databaseSchemaRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/database',
  component: DatabaseSchemaScreen,
});

const providerSettingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/providers',
  component: ProviderSettingsScreen,
});

const appSettingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: AppSettingsScreen,
});

const approvalsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/approvals',
  component: ApprovalsScreen,
});

const onboardingRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/onboarding',
  component: OnboardingAutomationScreen,
});

const logsHealthRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/logs',
  component: LogsHealthScreen,
});

// ── Route tree ────────────────────────────────────────────────────────
const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
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
  ]),
]);

export const router = createRouter({ routeTree });

// Type-safe router augmentation for IDE support
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
