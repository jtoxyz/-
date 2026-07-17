"use client";

import { useState, useEffect, useRef } from 'react';
import { Palette, Check } from 'lucide-react';

// [重要度: 低]
// 利用可能なテーマIDを型で限定し、想定外の文字列がテーマ設定へ入ることを防ぐ。
type Theme = 'white' | 'dark' | 'blue' | 'green' | 'pink';

// [重要度: 低]
// テーマ選択メニューに表示する名称と色見本。CSS側のdata-theme定義とIDを一致させること。
const THEMES: { id: Theme; name: string; color: string }[] = [
  { id: 'white', name: 'ホワイト', color: '#f6f8fb' },
  { id: 'dark', name: 'ダーク', color: '#111827' },
  { id: 'blue', name: 'ブルー', color: '#e0f2fe' },
  { id: 'green', name: 'グリーン', color: '#dcfce7' },
  { id: 'pink', name: 'ピンク', color: '#fce7f3' },
];

// [重要度: 低]
// 利用者が画面テーマを選択し、その設定をブラウザへ保存する表示用コンポーネント。
// 予約・当日券・権限などの業務処理には影響しない。
export default function ThemeSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<Theme>('white');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 外部クリック
    // [重要度: 低]
    // メニュー外をクリックした場合にテーマ一覧を閉じる。
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    // ESCキー
    // [重要度: 低]
    // キーボード操作でもメニューを閉じられるようにする。
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleEscKey);
    }
    // [重要度: 中]
    // 再描画のたびにイベントが重複登録されないよう、必ず同じリスナーを解除する。
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [isOpen]);

  useEffect(() => {
    // 初回マウント時にlocalStorageからテーマを読み込む
    // [重要度: 低]
    // 保存済みテーマが許可一覧に存在する場合だけ復元し、不正値はwhiteへ戻す。
    try {
      const stored = localStorage.getItem('theme') as Theme | null;
      if (stored && THEMES.some(t => t.id === stored)) {
        setCurrentTheme(stored);
      } else {
        // 不正な値や未設定時はwhiteを強制
        setCurrentTheme('white');
        localStorage.setItem('theme', 'white');
        document.documentElement.setAttribute('data-theme', 'white');
      }
    } catch (e) {
      console.error('Failed to access localStorage', e);
    }
  }, []);

  // [重要度: 低]
  // 選択したテーマをHTML属性とlocalStorageの両方へ反映する。
  // CSS側はdata-theme属性を参照するため、属性更新を削除すると表示だけ切り替わらなくなる。
  const changeTheme = (theme: Theme) => {
    setCurrentTheme(theme);
    setIsOpen(false);
    
    // HTML属性を更新
    document.documentElement.setAttribute('data-theme', theme);
    
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
  };

  return (
    <div className="theme-switcher-container" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="theme-switcher-btn"
        aria-label="テーマ切替"
        aria-expanded={isOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          borderRadius: '50%',
        }}
      >
        <Palette size={20} />
      </button>

      {isOpen && (
        <div
          className="theme-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '8px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--card-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            minWidth: '150px',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => changeTheme(theme.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '12px 16px',
                background: currentTheme === theme.id ? 'var(--card-bg)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--card-border)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: theme.color,
                    border: '1px solid rgba(128,128,128,0.2)',
                  }}
                />
                <span style={{ fontSize: '0.9rem' }}>{theme.name}</span>
              </div>
              {currentTheme === theme.id && <Check size={16} color="var(--color-primary)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}