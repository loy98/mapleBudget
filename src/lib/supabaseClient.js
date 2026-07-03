import { createClient } from "@supabase/supabase-js";

// 환경변수(빌드타임 주입). 미설정이면 클라우드 동기화 비활성(게스트 전용).
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const cloudEnabled = !!(url && anon);

export const supabase = cloudEnabled
  ? createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
