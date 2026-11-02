import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { makeSavecloudHandler } from './handler.mjs';

// Autenticação obrigatória no handler, inclusive quando o gateway não valida ES256.
// O cliente privilegiado fica somente no servidor e acessa apenas os RPCs do cofre.
// Autorização e fazendas continuam sendo conferidas pelo JWT do usuário no handler.
const storage = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
});
Deno.serve(makeSavecloudHandler({
    env: (name: string) => Deno.env.get(name),
    connectionStore: {
        async get() {
            const { data, error } = await storage().rpc('savecloud_connection_read');
            if (error) throw new Error('Connection storage unavailable');
            return data ? { token: data } : null;
        },
        async set(token: string) {
            const { error } = await storage().rpc('savecloud_connection_write', { p_token: token });
            if (error) throw new Error('Connection storage unavailable');
        }
    },
    userClient: (authorization: string) => createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: authorization } }
        })
}));
