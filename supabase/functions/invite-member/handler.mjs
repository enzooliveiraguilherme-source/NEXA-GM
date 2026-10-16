const redirectTo = 'https://nexa-gm.vercel.app/index.html';
export function makeInviteHandler({ userClient, adminClient }) {
    return async function handler(req) {
        const origin = req.headers.get('Origin') || '';
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': ['https://nexa-gm.vercel.app', 'https://nexa-gm-git-codex-mobile-preview-enzooliveiraguilherme-2123.vercel.app'].includes(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ? origin : 'https://nexa-gm.vercel.app',
            'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
            'Access-Control-Allow-Methods': 'POST, OPTIONS' };
        const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
        if (req.method === 'OPTIONS') return new Response('ok', { headers });
        if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
        const authorization = req.headers.get('Authorization') || '';
        if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Entre novamente para continuar.' });
        try {
            const client = userClient(authorization);
            const { data: { user }, error: authError } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
            if (authError || !user?.email_confirmed_at) return reply(401, { error: 'Seu acesso expirou. Entre novamente.' });
            const { data: allowed, error: permissionError } = await client.rpc('is_admin');
            if (permissionError || allowed !== true) return reply(403, { error: 'Somente administradores podem convidar membros.' });
            let body;
            try { body = await req.json(); } catch { return reply(400, { error: 'Confira os dados do convite.' }); }
            if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Confira os dados do convite.' });
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            const name = typeof body.name === 'string' ? body.name.trim() : '';
            if (body.resend_existing === true) {
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
                    Object.keys(body).some(key => !['email', 'resend_existing'].includes(key))) return reply(400, { error: 'Informe somente o e-mail do membro para reenviar o acesso.' });
                const { data: members, error: memberError } = await client.rpc('admin_list_access');
                if (memberError) return reply(503, { error: 'Não foi possível consultar os membros.' });
                const member = members.find(p => p.email?.toLowerCase() === email);
                if (!member || member.email_confirmed !== false) return reply(409, { error: 'Reenvio disponível somente para membros aguardando o primeiro acesso. Para uma conta ativa, use Esqueci minha senha.' });
                // Recuperação gera um novo OTP, sem trocar senha nem permissões existentes.
                const { error } = await adminClient.auth.resetPasswordForEmail(email, { redirectTo });
                if (error) return reply(error.status === 429 ? 429 : 503, { error: error.status === 429
                    ? 'Limite de envio atingido. Aguarde e tente novamente.' : 'Não foi possível enviar a senha temporária. Tente novamente.' });
                return reply(200, { invited: true, access_saved: true,
                    message: 'Nova senha temporária enviada, válida por 1 hora e de uso único. Na tela de senha temporária, selecione Recuperar senha. As permissões foram preservadas.' });
            }
            const role = body.role, all = body.all_farms, farms = body.farms;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length > 100 ||
                !['admin', 'projetista', 'visualizador'].includes(role) || typeof all !== 'boolean' ||
                !Array.isArray(farms) || farms.length > 100 || farms.some(f => typeof f !== 'string') ||
                (role === 'admin' && !all) || (!all && !farms.length)) {
                return reply(400, { error: 'Informe um e-mail, um cargo e as fazendas permitidas. Administradores têm acesso a todas as fazendas.' });
            }
            const { data: directory, error: farmError } = await client.from('farms').select('code');
            if (farmError) return reply(503, { error: 'Não foi possível validar as fazendas. Tente novamente.' });
            if (farms.some(code => !directory.some(f => f.code === code))) return reply(400, { error: 'Uma das fazendas selecionadas é inválida.' });
            const { data: members, error: memberError } = await client.rpc('admin_list_access');
            if (memberError) return reply(503, { error: 'Não foi possível consultar os membros. Tente novamente.' });
            if (members.some(p => p.email?.toLowerCase() === email)) return reply(409, { error: 'Este e-mail já está cadastrado. Reenvie a senha temporária pela lista de membros ou use Esqueci minha senha.' });
            const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: name || email } });
            if (error || !data?.user?.id) {
                return reply(error?.status === 429 ? 429 : error?.status >= 500 ? 503 : 400, { error: error?.status === 429
                    ? 'Limite de envio atingido. Aguarde alguns minutos e tente novamente.'
                    : error?.code === 'email_address_not_authorized' ? 'O serviço de e-mail ainda não permite enviar para este endereço. Configure o envio de e-mails do projeto.'
                    : 'Não foi possível enviar o convite. Confira se a conta já existe e se o serviço de e-mail está configurado.' });
            }
            const { error: accessError } = await client.rpc('admin_set_access', { target: data.user.id, new_role: role,
                all_access: all, farm_codes: all ? [] : [...new Set(farms)] });
            if (accessError) return reply(200, { invited: true, access_saved: false,
                message: 'O convite foi enviado, mas as permissões não foram salvas. O membro permanece sem fazendas liberadas; ajuste seu acesso na lista antes de ele entrar.' });
            return reply(200, { invited: true, access_saved: true, message: 'Senha temporária enviada. Ela vale por 1 hora e só pode ser usada uma vez. O colaborador deverá escolher a senha definitiva antes de acessar as fazendas liberadas.' });
        } catch { return reply(503, { error: 'Não foi possível concluir o convite. Confira a lista de membros antes de tentar novamente.' }); }
    };
}
