import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import ThemeSwitcher from '@/components/ThemeSwitcher';

export const metadata: Metadata = {
  title: '大学委員会 参加型企画予約システム',
  description: '大阪産業大学の委員会・サークル向け 参加予約＆電子チケット管理システム',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  var validThemes = ['white', 'dark', 'blue', 'green', 'pink'];
                  if (theme && validThemes.indexOf(theme) !== -1) {
                    document.documentElement.setAttribute('data-theme', theme);
                  } else {
                    document.documentElement.setAttribute('data-theme', 'white');
                    localStorage.setItem('theme', 'white');
                  }
                } catch (e) {
                  document.documentElement.setAttribute('data-theme', 'white');
                }
              })();
            `
          }}
        />
      </head>
      <body>
        <div className="app-container">
          <header className="header">
            <div className="header-container">
              <Link href="/" className="header-logo">
                🎫 委員会企画予約
              </Link>
              <nav style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '0.85rem' }}>
                <Link href="/tickets/find" style={{ color: 'var(--text-secondary)' }}>
                  チケットを探す
                </Link>
                <span style={{ color: 'var(--card-border)' }}>|</span>
                <Link href="/admin" style={{ color: 'var(--text-secondary)' }}>
                  管理画面
                </Link>
                <span style={{ color: 'var(--card-border)' }}>|</span>
                <ThemeSwitcher />
              </nav>
            </div>
          </header>
          
          <main className="main-content">
            {children}
          </main>

          <footer className="footer">
            <p>© {new Date().getFullYear()} 大学委員会 企画予約システム</p>
            <p style={{ fontSize: '0.8rem', marginTop: '6px' }}>
              製作：<a href="https://osu-denken.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>電子計算研究部</a>
            </p>
            <p style={{ fontSize: '0.75rem', marginTop: '6px', opacity: 0.5 }}>
              Cloudflare Pages + Supabase
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
