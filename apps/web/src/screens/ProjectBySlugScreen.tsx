// apps/web/src/screens/ProjectBySlugScreen.tsx — landing component for the
// `/projects/$slug` route.
//
// The SPS iframe-handoff flow redirects customers to
// `/projects/<slug>?spsHandoff=1[&embedded=true]` after the cookie is set on
// `/api/sps/handoff`. Before this route existed (round 13 INBOUND), the SPA
// rendered its catch-all "Not Found" body because TanStack Router only
// matched `/projects` (the list page). This component fills that gap.
//
// What it does, in order:
//   1. Read the `$slug` URL param via TanStack Router's useParams.
//   2. Look up a project with that slug in the project store. If found,
//      set it as the current project and render the existing Workspace.
//   3. If not found (cold load, e.g. iframe from SPS to a brand-new tab),
//      call loadProjectsFromServer() and retry once.
//   4. If still missing after the server fetch, show a clear "project not
//      found" empty state instead of a blank workspace.
//
// Workspace itself is left untouched — it continues to read
// currentProjectId from the store. We just make sure the store is
// pointing at the right project before mounting it.
//
// The `?spsHandoff=1` + `?embedded=true` query params are handled
// elsewhere: spsHandoff is informational (the auth cookie is already set
// server-side), embedded is read by Shell to hide TopBar (round 8). This
// component doesn't need to consume them — they flow through the standard
// shell layout.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useProjectStore } from '../lib/store/projectStore';
import { Workspace } from '../layout/MainWorkspace/Workspace';

export function ProjectBySlugScreen() {
  // TanStack Router types the param as the route's path declaration; we
  // pull it loosely here so we don't have to thread route types through.
  const { slug } = useParams({ strict: false }) as { slug?: string };

  const projects             = useProjectStore((s) => s.projects);
  const currentProjectId     = useProjectStore((s) => s.currentProjectId);
  const setCurrentProject    = useProjectStore((s) => s.setCurrentProject);
  const loadProjectsFromServer = useProjectStore((s) => s.loadProjectsFromServer);

  // Find the project record whose slug matches the URL param. Memoised so
  // we don't re-iterate the projects map on every render.
  const projectByThisSlug = useMemo(() => {
    if (!slug) return null;
    return Object.values(projects).find((p) => p.slug === slug) ?? null;
  }, [projects, slug]);

  /** Tracks whether we've already attempted a server fetch for the slug.
   *  Stops the effect from re-firing once we know the slug genuinely
   *  doesn't exist. */
  const [serverFetched, setServerFetched] = useState(false);

  // 1. If the slug matches a project we already have, point the store at
  //    it. Workspace renders the moment currentProjectId !== 'global'.
  useEffect(() => {
    if (!projectByThisSlug) return;
    if (currentProjectId === projectByThisSlug.id) return;
    setCurrentProject(projectByThisSlug.id);
  }, [projectByThisSlug, currentProjectId, setCurrentProject]);

  // 2. If we don't have the project locally yet (cold iframe from SPS,
  //    fresh tab, etc.), try to sync from the server exactly once. The
  //    store's syncFromDB() will populate `projects` and the effect
  //    above will fire on the next render with the found record.
  useEffect(() => {
    if (projectByThisSlug || serverFetched || !slug) return;
    void (async () => {
      try {
        await loadProjectsFromServer();
      } finally {
        setServerFetched(true);
      }
    })();
  }, [projectByThisSlug, serverFetched, slug, loadProjectsFromServer]);

  // ── Edge cases ────────────────────────────────────────────────────
  if (!slug) {
    return (
      <NotFoundShell
        title="No project slug in URL"
        body="The URL is missing the project slug. Open a project from the Projects list."
      />
    );
  }

  // Slug exists and matches → Workspace handles the rest. The store is
  // already pointing at the right project after the first effect.
  if (projectByThisSlug) {
    return <Workspace />;
  }

  // Slug doesn't match anything in the store. Two states:
  //   • Pre-fetch: probably an iframe cold-load; show a loading placeholder.
  //   • Post-fetch: definitively not found; show a useful empty state.
  if (!serverFetched) {
    return (
      <LoadingShell label="Loading project…" />
    );
  }

  return (
    <NotFoundShell
      title="Project not found"
      body={`No project with slug "${slug}" was found in this workspace. It may have been deleted, or you may not have access.`}
    />
  );
}

// ── Reusable shell wrappers ────────────────────────────────────────
// Borrow the project-store-aware shell from the existing
// abw-mode-placeholder class set so the visual matches Workspace's own
// "no project selected" state — no new CSS needed.

function LoadingShell({ label }: { label: string }) {
  return (
    <div className="abw-workspace">
      <div className="abw-mode-placeholder" style={{ height: '100%' }}>
        <span
          className="abw-mode-placeholder__icon"
          aria-hidden
          style={{ animation: 'abw-pulse 1.2s ease infinite' }}
        >
          ⚡
        </span>
        <span className="abw-mode-placeholder__label">{label}</span>
      </div>
    </div>
  );
}

function NotFoundShell({ title, body }: { title: string; body: string }) {
  return (
    <div className="abw-workspace">
      <div className="abw-mode-placeholder" style={{ height: '100%' }}>
        <span className="abw-mode-placeholder__icon" aria-hidden>🗂</span>
        <span className="abw-mode-placeholder__label">{title}</span>
        <span
          className="abw-mode-placeholder__sub"
          style={{ maxWidth: 480, textAlign: 'center', marginTop: 'var(--space-2)' }}
        >
          {body}
        </span>
      </div>
    </div>
  );
}
