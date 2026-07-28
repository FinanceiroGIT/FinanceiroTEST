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
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'fixed',
    top: '28px',
    right: '16px',
    zIndex: '9999',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  });

  const badge = document.createElement('div');
  badge.id = 'finfortesSessionTimer';
  Object.assign(badge.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '10px',
    fontWeight: '500',
    padding: '4px 9px',
    borderRadius: '999px',
    background: 'rgba(255, 255, 255, 0.6)',
    border: '1px solid rgba(31, 45, 61, 0.08)',
    color: '#8a98a8',
    letterSpacing: '0.02em',
    boxShadow: '0 1px 3px rgba(20, 35, 72, 0.06)',
    backdropFilter: 'blur(6px)',
    transition: 'background .25s ease, color .25s ease, border-color .25s ease',
    pointerEvents: 'none'
  });

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.id = 'finfortesLogoutBtn';
  logoutBtn.title = 'Encerrar sessão';
  logoutBtn.textContent = 'Sair';
  Object.assign(logoutBtn.style, {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '10px',
    fontWeight: '600',
    padding: '4px 10px',
    borderRadius: '999px',
    background: 'rgba(255, 255, 255, 0.6)',
    border: '1px solid rgba(31, 45, 61, 0.08)',
    color: '#5a6b7d',
    letterSpacing: '0.02em',
    boxShadow: '0 1px 3px rgba(20, 35, 72, 0.06)',
    backdropFilter: 'blur(6px)',
    cursor: 'pointer'
  });
  logoutBtn.addEventListener('mouseenter', () => {
    logoutBtn.style.background = 'rgba(212, 58, 85, 0.1)';
    logoutBtn.style.borderColor = 'rgba(212, 58, 85, 0.25)';
    logoutBtn.style.color = '#b23a52';
  });
  logoutBtn.addEventListener('mouseleave', () => {
    logoutBtn.style.background = 'rgba(255, 255, 255, 0.6)';
    logoutBtn.style.borderColor = 'rgba(31, 45, 61, 0.08)';
    logoutBtn.style.color = '#5a6b7d';
  });
  logoutBtn.addEventListener('click', () => {
    forceLogout();
  });

  wrap.appendChild(badge);
  wrap.appendChild(logoutBtn);
  document.body.appendChild(wrap);
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

  let interval;

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
    badge.innerHTML = `<span style="width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.6;flex-shrink:0;"></span>Sessão expira em ${mm}:${ss}`;
    if (remaining <= 60000) {
      badge.style.background = 'rgba(212, 58, 85, 0.1)'; // alerta discreto nos últimos 60s
      badge.style.borderColor = 'rgba(212, 58, 85, 0.25)';
      badge.style.color = '#b23a52';
    }
  };

  tick();
  interval = setInterval(tick, 1000);
}

if (session) {
  startSessionCountdown();
  document.documentElement.classList.remove('finfortes-checking');
}

// Exporta o client pra a página poder reusar (evita criar múltiplas instâncias)
window.__finfortesSupabase = supabase;