/**
 * Client-side ticket cache utilities.
 * Handles saving and retrieving public tokens from localStorage and document.cookie.
 * This is used solely to list "already reserved tickets" on the home page for user convenience.
 */

const CACHE_KEY = 'saved_event_tickets';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return;
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `; expires=${date.toUTCString()}`;
  document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/; SameSite=Lax`;
}

export function getSavedTokens(): string[] {
  if (typeof window === 'undefined') return [];

  let tokens: string[] = [];

  // Try localStorage
  try {
    const localData = localStorage.getItem(CACHE_KEY);
    if (localData) {
      tokens = JSON.parse(localData);
    }
  } catch (e) {
    console.error('Error reading localStorage ticket cache:', e);
  }

  // Try Cookies if empty
  if (tokens.length === 0) {
    try {
      const cookieData = getCookie(CACHE_KEY);
      if (cookieData) {
        tokens = JSON.parse(decodeURIComponent(cookieData));
      }
    } catch (e) {
      console.error('Error reading cookie ticket cache:', e);
    }
  }

  // Ensure it is always an array of unique strings
  if (!Array.isArray(tokens)) {
    return [];
  }
  return Array.from(new Set(tokens.filter((t) => typeof t === 'string' && t.trim() !== '')));
}

export function saveToken(token: string) {
  if (typeof window === 'undefined' || !token) return;

  const tokens = getSavedTokens();
  if (!tokens.includes(token)) {
    tokens.push(token);
    
    // Save to localStorage
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(tokens));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }

    // Save to Cookie
    try {
      setCookie(CACHE_KEY, JSON.stringify(tokens));
    } catch (e) {
      console.error('Failed to save to cookie:', e);
    }
  }
}

export function removeToken(token: string) {
  if (typeof window === 'undefined') return;

  let tokens = getSavedTokens();
  tokens = tokens.filter((t) => t !== token);

  // Update localStorage
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(tokens));
  } catch (e) {
    console.error('Failed to update localStorage cache:', e);
  }

  // Update Cookie
  try {
    setCookie(CACHE_KEY, JSON.stringify(tokens));
  } catch (e) {
    console.error('Failed to update cookie cache:', e);
  }
}
