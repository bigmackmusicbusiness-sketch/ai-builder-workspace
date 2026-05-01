// apps/web/src/screens/CreateHubScreen.tsx — single landing for the four creative tools.
// Replaces the TopBar "Create" dropdown with an intentional hub. Each card links to
// the dedicated tool screen (eBooks, Documents, Email, Music, Video).
import { Link } from '@tanstack/react-router';

interface CreateOption {
  to:    string;
  icon:  string;
  label: string;
  desc:  string;
}

const OPTIONS: CreateOption[] = [
  { to: '/ebooks',    icon: '📖', label: 'eBooks',    desc: 'AI-generated or formatted manuscripts. PDF + EPUB + KDP-ready.' },
  { to: '/documents', icon: '📄', label: 'Documents', desc: 'Proposals, case studies, reports, invoices, pitch decks.'        },
  { to: '/email',     icon: '✉️',  label: 'Email',     desc: 'HTML email composer with live preview + Resend / SendGrid send.' },
  { to: '/music',     icon: '🎵', label: 'Music',     desc: 'Rap beat or cinematic background — stems + final mix.'           },
  { to: '/video',     icon: '🎬', label: 'Video',     desc: 'Movies, commercials, shorts, music videos. AI Clipper too.'      },
];

export function CreateHubScreen() {
  return (
    <div className="abw-screen">
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Create</h1>
          <p className="abw-screen__sub">Pick a creative tool. Each one writes outputs back to the active project.</p>
        </div>
      </div>

      <div
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap:                 'var(--space-4)',
        }}
      >
        {OPTIONS.map((opt) => (
          <Link
            key={opt.to}
            to={opt.to}
            className="abw-card"
            style={{
              display:        'flex',
              flexDirection:  'column',
              gap:            'var(--space-2)',
              textDecoration: 'none',
              color:          'inherit',
              cursor:         'pointer',
              transition:     'border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--accent-500)';
              (e.currentTarget as HTMLAnchorElement).style.transform   = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border-base)';
              (e.currentTarget as HTMLAnchorElement).style.transform   = 'translateY(0)';
            }}
          >
            <span aria-hidden style={{ fontSize: '2rem', lineHeight: 1 }}>{opt.icon}</span>
            <span style={{ fontSize: '1rem', fontWeight: 600 }}>{opt.label}</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{opt.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
