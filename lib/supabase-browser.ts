import { createClient } from "@supabase/supabase-js";

// Browser-side client using NEXT_PUBLIC_ env vars
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);
