// packages/publish/types.ts — shared types for publish adapters.

export interface DeployResult {
  /** Live URL of the published project (e.g. https://my-site.pages.dev) */
  url:         string;
  /** Wall-clock time for the deploy call in milliseconds */
  durationMs:  number;
  /** Cloudflare deployment ID or other provider-specific ID */
  deploymentId?: string;
}

export interface PublishAdapter {
  /** Identifier for this adapter — matches `publish_targets.adapter` */
  readonly id: string;
  /**
   * Deploy bundled assets to the target.
   * @param projectSlug  Unique project slug used to name the remote project.
   * @param assets       Map of asset path → raw bytes (output of bundleProject).
   * @param accountId    Provider account identifier (from vault/config).
   * @param token        Provider API token (from vault).
   */
  deploy(
    projectSlug: string,
    assets: Map<string, Uint8Array>,
    accountId: string,
    token: string,
  ): Promise<DeployResult>;
}
