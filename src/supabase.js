// Supabase クライアントを1か所で作って、各画面から使い回す
import { createClient } from '@supabase/supabase-js';

// Parcel が .env の値をビルド時にここへ埋め込みます
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export const isConfigured =
  !!SUPABASE_URL && SUPABASE_URL.startsWith('https://') && !!SUPABASE_ANON_KEY;

if (!isConfigured) {
  console.error(
    '.env の SUPABASE_URL / SUPABASE_ANON_KEY が未設定です。設定後、npm run dev を再起動してください。'
  );
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder'
);
