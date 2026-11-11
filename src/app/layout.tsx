import type { Metadata, Viewport } from 'next';
import './globals.css';
import Link from 'next/link';
import { Ticket } from 'lucide-react';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import StudentAuthGate from '@/components/StudentAuthGate';
import StudentAccountMenu from '@/components/StudentAccountMenu';
import NoShowNotice from '@/components/NoShowNotice';

export const metadata: Metadata = {
  title: '大学委員会 参加型企画予約システム',
  description: '大阪産業大学の委員会・サークル向け 参加予約＆電子チケット管理システム',
  // 予約のリンクを受け取った人だけが使うサイトなので、検索エンジンに載せない(2026-10-27)
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: { url: '/icon.svg', type: 'image/svg+xml' },
    apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
  },
  appleWebApp: {
    capable: true,
    title: '委員会予約',
    statusBarStyle: 'default',
  },
};

// Next 16 では viewport は metadata ではなくここで指定する。拡大は禁止しない（文字を大きくして読む人のため）
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
            `,
          }}
        />
      </head>
      <body>
        <div className="app-container">
          <header className="header">
            <div className="header-container">
              <Link href="/" className="header-logo">
                <Ticket size={23} strokeWidth={2.2} aria-hidden="true" />
                <span>委員会企画予約</span>
              </Link>
              <nav className="header-nav" aria-label="メインメニュー">
                <Link href="/tickets/find" className="header-nav-link">
                  チケットを探す
                </Link>
                <span className="header-nav-sep" aria-hidden="true">|</span>
                <StudentAccountMenu />
                <Link href="/admin" className="header-nav-link">
                  管理画面
                </Link>
              </nav>
              {/* スマホではロゴと同じ行の右端に出す（メニューが多いときに3行にならないように） */}
              <div className="header-theme">
                <ThemeSwitcher />
              </div>
            </div>
          </header>

          <main className="main-content">
            <StudentAuthGate><NoShowNotice />{children}</StudentAuthGate>
          </main>

          <footer className="footer">
            <p>© {new Date().getFullYear()} 大学委員会 企画予約システム</p>
            <p style={{ fontSize: '0.8rem', marginTop: '6px' }}>
              製作：<a href="https://osu-denken.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>電子計算研究部</a>
            </p>
            <p style={{ fontSize: '0.8rem', marginTop: '10px' }}>
              <Link href="/staff" style={{ color: 'var(--text-secondary)' }}>スタッフ用画面（自治会など）</Link>
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
