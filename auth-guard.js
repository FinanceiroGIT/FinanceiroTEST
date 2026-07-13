import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = "https://skvayfwuaelxxnhctlhv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_io0L_HpoZeWfh4jlQvBN-Q_R2N9cBwb";

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

// Exporta o client pra a página poder reusar (evita criar múltiplas instâncias)
window.__finfortesSupabase = supabase;