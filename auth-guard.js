// auth-guard.js
// Inclua este script no <head>, ANTES do resto do conteúdo, em toda página
// que exige login (index.html e as futuras páginas internas do Finfortes).
//
// Uso:
// <script type="module" src="/auth-guard.js"></script>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = "https://skvayfwuaelxxnhctlhv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_io0L_HpoZeWfh4jlQvBN-Q_R2N9cBwb";
const SESSION_LIMIT_MS = 10 * 60 * 1000; // 10 minutos

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  window.location.replace('/login');
}

// Reage também se a sessão expirar/for encerrada enquanto a pessoa está na página
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    window.location.replace('/login');
  }
});

// ---- Limite de sessão de 10 minutos com cronômetro visível ----
async function forceLogout() {
  localStorage.removeItem('finfortes_login_at');
  await supabase.auth.signOut();
  window.location.replace('/login');
}

function injectTimerBadge() {
  const badge = document.createElement('div');
  badge.id = 'finfortesSessionTimer';
  Object.assign(badge.style, {
    position: 'fixed',
    top: '14px',
    right: '16px',
    zIndex: '9999',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '12.5px',
    fontWeight: '600',
    padding: '6px 10px',
    borderRadius: '8px',
    background: 'rgba(20, 35, 72, 0.9)',
    color: '#EEF1FF',
    letterSpacing: '0.03em',
    pointerEvents: 'none'
  });
  document.body.appendChild(badge);
  return badge;
}

function startSessionCountdown() {
  let loginAt = Number(localStorage.getItem('finfortes_login_at'));
  if (!loginAt) {
    // Sessão sem marcação (ex: já existia antes desse controle) — começa a contar agora
    loginAt = Date.now();
    localStorage.setItem('finfortes_login_at', loginAt.toString());
  }

  const badge = injectTimerBadge();

  const tick = () => {
    const remaining = SESSION_LIMIT_MS - (Date.now() - loginAt);
    if (remaining <= 0) {
      clearInterval(interval);
      forceLogout();
      return;
    }
    const totalSeconds = Math.ceil(remaining / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    badge.textContent = `Sessão expira em ${mm}:${ss}`;
    if (remaining <= 60000) {
      badge.style.background = 'rgba(180, 57, 47, 0.92)'; // alerta nos últimos 60s
    }
  };

  tick();
  const interval = setInterval(tick, 1000);
}

if (session) {
  startSessionCountdown();
  document.documentElement.classList.remove('finfortes-checking');
}

// Exporta o client pra a página poder reusar (evita criar múltiplas instâncias)
window.__finfortesSupabase = supabase;