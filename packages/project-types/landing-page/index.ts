// packages/project-types/landing-page/index.ts — Landing Page project type.
// Single-page conversion-focused layout: Hero, Social Proof, Features, Pricing, FAQ, CTA.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}

function buildPage(name: string, accent: string, desc: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <meta name="description" content="${desc}" />
  <meta property="og:title" content="${name}" />
  <meta property="og:type" content="website" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>

<header class="lp-nav">
  <div class="container">
    <span class="lp-brand">${name}</span>
    <a href="#cta" class="btn btn-primary btn-sm">Get started</a>
  </div>
</header>

<!-- Hero -->
<section class="lp-hero">
  <div class="container">
    <div class="lp-badge">New · Just launched</div>
    <h1>${name}</h1>
    <p class="lp-sub">${desc}</p>
    <div class="lp-actions">
      <a href="#cta" class="btn btn-primary">Get started free</a>
      <a href="#features" class="btn btn-ghost">Learn more</a>
    </div>
  </div>
</section>

<!-- Social proof -->
<section class="lp-proof">
  <div class="container">
    <p class="lp-proof-label">Trusted by teams at</p>
    <div class="lp-logos">
      <span class="lp-logo-chip">Acme Co</span>
      <span class="lp-logo-chip">Globex</span>
      <span class="lp-logo-chip">Initech</span>
      <span class="lp-logo-chip">Umbrella</span>
    </div>
  </div>
</section>

<!-- Features -->
<section id="features" class="lp-features">
  <div class="container">
    <h2>Everything you need</h2>
    <p class="lp-section-sub">Built for speed, reliability, and simplicity.</p>
    <div class="lp-features-grid">
      <div class="lp-feature-card">
        <div class="lp-feature-icon">⚡</div>
        <h3>Blazing fast</h3>
        <p>Optimized for performance from day one.</p>
      </div>
      <div class="lp-feature-card">
        <div class="lp-feature-icon">🔒</div>
        <h3>Secure by default</h3>
        <p>Enterprise-grade security baked in.</p>
      </div>
      <div class="lp-feature-card">
        <div class="lp-feature-icon">🔌</div>
        <h3>Easy integrations</h3>
        <p>Connect your existing tools in minutes.</p>
      </div>
    </div>
  </div>
</section>

<!-- Pricing -->
<section class="lp-pricing">
  <div class="container">
    <h2>Simple, transparent pricing</h2>
    <div class="lp-pricing-grid">
      <div class="lp-plan">
        <div class="lp-plan-name">Starter</div>
        <div class="lp-plan-price">$0<span>/mo</span></div>
        <ul class="lp-plan-features">
          <li>Up to 3 projects</li>
          <li>Basic analytics</li>
          <li>Community support</li>
        </ul>
        <a href="#cta" class="btn btn-ghost">Get started</a>
      </div>
      <div class="lp-plan lp-plan--featured">
        <div class="lp-plan-badge">Most popular</div>
        <div class="lp-plan-name">Pro</div>
        <div class="lp-plan-price">$29<span>/mo</span></div>
        <ul class="lp-plan-features">
          <li>Unlimited projects</li>
          <li>Advanced analytics</li>
          <li>Priority support</li>
          <li>Custom domain</li>
        </ul>
        <a href="#cta" class="btn btn-primary">Get started</a>
      </div>
      <div class="lp-plan">
        <div class="lp-plan-name">Enterprise</div>
        <div class="lp-plan-price">Custom</div>
        <ul class="lp-plan-features">
          <li>Everything in Pro</li>
          <li>SLA &amp; SSO</li>
          <li>Dedicated support</li>
        </ul>
        <a href="#cta" class="btn btn-ghost">Contact us</a>
      </div>
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="lp-faq">
  <div class="container">
    <h2>Frequently asked questions</h2>
    <div class="lp-faq-list">
      <details class="lp-faq-item">
        <summary>How does billing work?</summary>
        <p>You're billed monthly. Cancel anytime with no penalties.</p>
      </details>
      <details class="lp-faq-item">
        <summary>Can I change plans later?</summary>
        <p>Yes, upgrade or downgrade at any time from your account settings.</p>
      </details>
      <details class="lp-faq-item">
        <summary>Is there a free trial?</summary>
        <p>The Starter plan is free forever. No credit card required.</p>
      </details>
    </div>
  </div>
</section>

<!-- CTA -->
<section id="cta" class="lp-cta">
  <div class="container">
    <h2>Start building today</h2>
    <p>No credit card required. Cancel anytime.</p>
    <form class="lp-cta-form" onsubmit="return false">
      <input type="email" placeholder="Enter your email" class="lp-input" required />
      <button type="submit" class="btn btn-primary">Get started free</button>
    </form>
  </div>
</section>

<footer class="lp-footer">
  <div class="container">
    <p>&copy; ${new Date().getFullYear()} ${name}. All rights reserved.</p>
  </div>
</footer>

</body>
</html>
`;
}

function buildStyles(accent: string): string {
  return `/* Generated by AI Builder — landing-page project */
:root {
  --color-accent: ${accent};
  --color-text:   #111827;
  --color-bg:     #ffffff;
  --color-bg-alt: #f9fafb;
  --font-sans:    system-ui, -apple-system, sans-serif;
  --radius:       10px;
  --max-w:        1100px;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 16px; scroll-behavior: smooth; }
body { font-family: var(--font-sans); color: var(--color-text); background: var(--color-bg); line-height: 1.65; }
.container { max-width: var(--max-w); margin: 0 auto; padding: 0 1.5rem; }

/* Nav */
.lp-nav { position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid #e5e7eb; padding: 0.875rem 0; }
.lp-nav .container { display: flex; align-items: center; justify-content: space-between; }
.lp-brand { font-weight: 700; font-size: 1.125rem; }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.625rem 1.5rem; border-radius: var(--radius); font-weight: 600; text-decoration: none; border: none; cursor: pointer; transition: opacity 0.18s; font-size: 0.9375rem; }
.btn-primary { background: var(--color-accent); color: #fff; }
.btn-primary:hover { opacity: 0.88; }
.btn-ghost { background: transparent; color: var(--color-text); border: 1.5px solid #d1d5db; }
.btn-ghost:hover { border-color: var(--color-accent); }
.btn-sm { padding: 0.4375rem 1rem; font-size: 0.875rem; }

/* Hero */
.lp-hero { padding: 7rem 0 5rem; text-align: center; background: var(--color-bg-alt); }
.lp-badge { display: inline-block; background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); padding: 0.25rem 0.75rem; border-radius: 100px; font-size: 0.8125rem; font-weight: 600; margin-bottom: 1.25rem; }
.lp-hero h1 { font-size: clamp(2.25rem, 6vw, 4rem); font-weight: 800; letter-spacing: -0.02em; margin-bottom: 1.25rem; }
.lp-sub { font-size: 1.25rem; opacity: 0.65; max-width: 540px; margin: 0 auto 2.5rem; }
.lp-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }

/* Social proof */
.lp-proof { padding: 2.5rem 0; border-bottom: 1px solid #e5e7eb; }
.lp-proof .container { display: flex; align-items: center; gap: 2rem; flex-wrap: wrap; }
.lp-proof-label { font-size: 0.8125rem; opacity: 0.55; white-space: nowrap; }
.lp-logos { display: flex; gap: 1.5rem; flex-wrap: wrap; }
.lp-logo-chip { font-size: 0.875rem; font-weight: 600; opacity: 0.5; }

/* Features */
.lp-features { padding: 6rem 0; }
.lp-features h2 { text-align: center; font-size: 2rem; font-weight: 700; margin-bottom: 0.75rem; }
.lp-section-sub { text-align: center; opacity: 0.6; margin-bottom: 3rem; }
.lp-features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; }
.lp-feature-card { padding: 2rem; border: 1px solid #e5e7eb; border-radius: var(--radius); }
.lp-feature-icon { font-size: 1.75rem; margin-bottom: 1rem; }
.lp-feature-card h3 { font-size: 1.0625rem; font-weight: 600; margin-bottom: 0.5rem; }
.lp-feature-card p { opacity: 0.65; font-size: 0.9375rem; }

/* Pricing */
.lp-pricing { padding: 6rem 0; background: var(--color-bg-alt); }
.lp-pricing h2 { text-align: center; font-size: 2rem; font-weight: 700; margin-bottom: 3rem; }
.lp-pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.5rem; max-width: 900px; margin: 0 auto; }
.lp-plan { padding: 2rem; background: #fff; border: 1px solid #e5e7eb; border-radius: var(--radius); position: relative; }
.lp-plan--featured { border-color: var(--color-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent); }
.lp-plan-badge { position: absolute; top: -0.75rem; left: 50%; transform: translateX(-50%); background: var(--color-accent); color: #fff; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.75rem; border-radius: 100px; white-space: nowrap; }
.lp-plan-name { font-weight: 700; font-size: 1.0625rem; margin-bottom: 0.5rem; }
.lp-plan-price { font-size: 2.25rem; font-weight: 800; margin-bottom: 1.5rem; }
.lp-plan-price span { font-size: 1rem; font-weight: 400; opacity: 0.6; }
.lp-plan-features { list-style: none; margin-bottom: 2rem; display: flex; flex-direction: column; gap: 0.5rem; }
.lp-plan-features li::before { content: "✓ "; color: var(--color-accent); font-weight: 700; }
.lp-plan-features li { font-size: 0.9375rem; opacity: 0.8; }

/* FAQ */
.lp-faq { padding: 6rem 0; }
.lp-faq h2 { text-align: center; font-size: 2rem; font-weight: 700; margin-bottom: 3rem; }
.lp-faq-list { max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.75rem; }
.lp-faq-item { border: 1px solid #e5e7eb; border-radius: var(--radius); overflow: hidden; }
.lp-faq-item summary { padding: 1.125rem 1.25rem; font-weight: 600; cursor: pointer; list-style: none; }
.lp-faq-item summary::-webkit-details-marker { display: none; }
.lp-faq-item p { padding: 0 1.25rem 1.25rem; opacity: 0.7; font-size: 0.9375rem; }

/* CTA */
.lp-cta { padding: 6rem 0; background: var(--color-accent); color: #fff; text-align: center; }
.lp-cta h2 { font-size: 2rem; font-weight: 700; margin-bottom: 0.75rem; }
.lp-cta p { opacity: 0.8; margin-bottom: 2rem; }
.lp-cta-form { display: flex; gap: 0.75rem; max-width: 440px; margin: 0 auto; flex-wrap: wrap; justify-content: center; }
.lp-input { flex: 1; min-width: 220px; padding: 0.625rem 1rem; border-radius: var(--radius); border: none; font-size: 0.9375rem; }

/* Footer */
.lp-footer { padding: 2rem 0; text-align: center; font-size: 0.875rem; opacity: 0.55; }

@media (max-width: 640px) {
  .lp-hero { padding: 4.5rem 0 3rem; }
  .lp-actions { flex-direction: column; align-items: center; }
}
`;
}

export const landingPage: ProjectType = {
  id:          'landing-page',
  label:       'Landing Page',
  description: 'Single-page conversion layout: Hero, Proof, Features, Pricing, FAQ, CTA.',
  icon:        '📣',

  scaffold(input: ScaffoldInput): FileTree {
    const accent = input.accentColor ?? '#6366f1';
    const desc   = input.description ?? `${input.projectName} — your description here.`;
    return {
      'index.html': buildPage(input.projectName, accent, desc),
      'styles.css': buildStyles(accent),
      'README.md':  `# ${input.projectName}\n\n${desc}\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan', 'playwrightRuntime', 'screenshotDiff'],

  defaultApprovalPolicy: {
    alwaysApprove: ['publish.live'],
  },

  screens: ['preview', 'code', 'files', 'tests', 'visualqa'],
  agentInstructions: {
    systemPromptPrelude: 'types/landing-page.md',
    copyGuidance:
      'Single-page conversion-focused. Hero/proof/features/pricing/FAQ/CTA. Strong CTA above fold. Niche detection picks SaaS launch / lead-gen / event / course / app download / consultation patterns.',
    securitySOPs: [
      'No hardcoded API keys (sk-, AKIA, pk_live_, ghp_, ya29., JWT-shaped) — auto-strip',
      'rel="noopener noreferrer" on target="_blank" — auto-fix',
      'Form fields must have <label> — auto-fix',
    ],
    multiPageStrategy: {
      nicheManifestPath: 'types/landing-page/niches/',
      detectFromPrompt:  true,
    },
    assetBudget: { images: 4, icons: 8 },
  },
};
