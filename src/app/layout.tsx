import type { Metadata } from 'next';
import './globals.css';
import './display-enhancements.css';
import Link from 'next/link';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import DisplayEnhancer from '@/components/DisplayEnhancer';

// [重要度: 低]
// 全ページ共通のタイトル・説明・画面表示設定。予約ロジックには影響しないが、検索結果やスマートフォン表示に影響する。
export const metadata: Metadata = {
  title: '大学委員会 参加型企画予約システム',
  description: '大阪産業大学の委員会・サークル向け 参加予約＆電子チケット管理システム',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
};

// [重要度: 中]
// 一般画面・管理画面を含む全ページに共通するHTML構造、ヘッダー、フッター、テーマ処理を提供する。
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* [重要度: 中]
            Reactの描画前に保存済みテーマを適用し、初期表示で一瞬別テーマが見える現象を防ぐ。
            ThemeSwitcher側の許可テーマ一覧と同じIDを維持すること。 */}
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
        {/* [重要度: 低]
            既存画面の日時表示や補助ボタンをDOM描画後に整える表示専用コンポーネント。 */}
        <DisplayEnhancer />
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
          
          {/* [重要度: 低]
              各ページ固有の内容を共通レイアウト内へ表示する。 */}
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