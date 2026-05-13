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
import { AppSettingsScreen }          from '../screens/AppSettingsScreen';
import { CreateHubScreen }            from '../screens/CreateHubScreen';
import { ApprovalsScreen }            from '../screens/ApprovalsScreen';
import { OnboardingAutomationScreen } from '../screens/OnboardingAutomationScreen';
import { LogsHealthScreen }           from '../screens/LogsHealthScreen';
import { ProjectsScreen }             from '../screens/ProjectsScreen';
import { ProjectBySlugScreen }        from '../screens/ProjectBySlugScreen';
import { PublishScreen }              from '../screens/PublishScreen';
import { IntegrationsScreen }         from '../screens/IntegrationsScreen';
import { AgentRunsScreen }            from '../screens/AgentRunsScreen';
import { VersionsScreen }             from '../screens/VersionsScreen';
import { AssetsScreen }               from '../screens/AssetsScreen';
import { TemplatesScreen }            from '../screens/TemplatesScreen';
import { EbooksScreen }               from '../screens/EbooksScreen';
import { DocumentsScreen }            from '../screens/DocumentsScreen';
import { EmailComposerScreen }        from '../screens/EmailComposerScreen';
import { MusicStudioScreen }          from '../screens/MusicStudioScreen';
import { VideoStudioScreen }          from '../screens/VideoStudioScreen';
import { VideoEditorScreen }          from '../screens/VideoEditorScreen';
import { VisualEditorScreen }         from '../screens/VisualEditorScreen';
import { AdsStudioScreen }            from '../screens/AdsStudioScreen';
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
    // Wait for auth store to finish hydrating (getSession is async).
    // 6-second timeout prevents an infinite hang if Supabase is unreachable.
    const store = useAuthStore.getState();
    if (store.loading) {
      await Promise.race([
        new Promise<void>((resolve) => {
          const unsub = useAuthStore.subscribe((s) => {
            if (!s.loading) { unsub(); resolve(); }
          });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 6000)),
      ]);
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

// Per-project IDE landing — matches `/projects/$slug` from the SPS
// iframe-handoff flow (POST /api/sps/handoff redirects here after
// setting the auth cookie). TanStack Router resolves more-specific
// routes first, so `/projects` still matches the list page.
const projectDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/$slug',
  component: ProjectBySlugScreen,
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

const ebooksRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/ebooks',
  component: EbooksScreen,
});

const documentsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/documents',
  component: DocumentsScreen,
});

const emailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/email',
  component: EmailComposerScreen,
});

const musicRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/music',
  component: MusicStudioScreen,
});

const videoRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/video',
  component: VideoStudioScreen,
});

const videoEditorRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/edit/video/$id',
  component: VideoEditorScreen,
});

const editorRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/edit/$sessionId',
  component: VisualEditorScreen,
});

const createHubRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/create',
  component: CreateHubScreen,
});

const adsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/ads',
  component: AdsStudioScreen,
});

// ── Route tree ────────────────────────────────────────────────────────
const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    workspaceRoute,
    projectsRoute,
    projectDetailRoute,
    templatesRoute,
    agentRunsRoute,
    versionsRoute,
    assetsRoute,
    publishRoute,
    integrationsRoute,
    envSecretsRoute,
    jobsQueuesRoute,
    databaseSchemaRoute,
    appSettingsRoute,
    approvalsRoute,
    onboardingRoute,
    logsHealthRoute,
    ebooksRoute,
    documentsRoute,
    emailRoute,
    musicRoute,
    videoRoute,
    videoEditorRoute,
    editorRoute,
    createHubRoute,
    adsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

// Type-safe router augmentation for IDE support
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
