import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { makeInviteHandler } from './handler.mjs';
// O projeto usa ES256 (JWKS público conferido). O verificador legado da
// plataforma não aceita essas chaves. A autenticação permanece obrigatória
// no handler: getUser(token) valida no Auth e is_admin() valida o cargo
// atual no banco antes de acessar inviteUserByEmail com a chave privada.
const url = Deno.env.get('SUPABASE_URL')!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
Deno.serve(makeInviteHandler({
    userClient: (authorization: string) => createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!,
        { ...options, global: { headers: { Authorization: authorization } } }),
    adminClient: createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options)
}));
