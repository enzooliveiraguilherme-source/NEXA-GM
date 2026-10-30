import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { makeSavecloudHandler } from './handler.mjs';

// Autenticação obrigatória no handler, inclusive quando o gateway não valida ES256.
// Não usa service_role e não grava dados externos em banco ou Storage.
Deno.serve(makeSavecloudHandler({
    env: (name: string) => Deno.env.get(name),
    userClient: (authorization: string) => createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: authorization } }
        })
}));
