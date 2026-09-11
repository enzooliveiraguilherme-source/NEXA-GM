(function () {
    const config = window.GEO_PORTAL_CONFIG || {};
    const configured = config.supabaseUrl && config.supabaseAnonKey &&
        !config.supabaseUrl.includes('COLE_AQUI') && !config.supabaseAnonKey.includes('COLE_AQUI');

    window.portalReady = (async () => {
        const isLoginPage = document.body?.dataset.page === 'login';
        if (!configured || !window.supabase) {
            if (isLoginPage) showConfigNotice();
            return false;
        }

        window.supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        const { data: { session } } = await window.supabaseClient.auth.getSession();

        if (!session) {
            if (!isLoginPage) window.location.replace('./index.html');
            return false;
        }

        if (isLoginPage) {
            await redirectByRole(session.user);
            return false;
        }

        const profile = await getProfile(session.user);
        if (!profile) {
            window.location.replace('./index.html?erro=perfil');
            return false;
        }

        window.portalProfile = profile;
        window.portalAccessRole = profile.role;
        window.portalUser = session.user;
        document.body.dataset.accessRole = profile.role;
        document.documentElement.classList.remove('portal-loading');
        document.getElementById('auth-loading-overlay')?.remove();
        return true;
    })().catch((error) => {
        console.error('Falha na autenticação:', error);
        if (document.body?.dataset.page !== 'login') window.location.replace('./index.html?erro=acesso');
        return false;
    });

    async function getProfile(user) {
        try {
            const { data, error } = await window.supabaseClient
                .from('profiles')
                .select('id, full_name, role')
                .eq('id', user.id)
                .single();
            if (error) {
                console.warn('Aviso ao buscar perfil no Supabase:', error);
                // Fallback de contingência caso a tabela profiles no Supabase ainda não tenha permissões concedidas
                if (user.email === 'enzo.oliveira@grupomichels.com.br') {
                    return {
                        id: user.id,
                        full_name: user.user_metadata?.full_name || 'Enzo Oliveira',
                        role: 'admin'
                    };
                }
                return null;
            }
            return data;
        } catch (err) {
            console.error('Erro na requisição de perfil:', err);
            if (user.email === 'enzo.oliveira@grupomichels.com.br') {
                return {
                    id: user.id,
                    full_name: user.user_metadata?.full_name || 'Enzo Oliveira',
                    role: 'admin'
                };
            }
            return null;
        }
    }

    async function redirectByRole(user) {
        const profile = await getProfile(user);
        if (!profile) {
            const message = document.getElementById('login-message');
            if (message) {
                message.textContent = 'Perfil não encontrado na tabela profiles do Supabase. Verifique o banco.';
            }
            return false;
        }
        const destinations = {
            admin: './admin.html',
            projetista: './projetista.html',
            visualizador: './visualizador.html'
        };
        const dest = destinations[profile.role] || './visualizador.html';
        window.location.replace(dest);
        return true;
    }

    function showConfigNotice() {
        const notice = document.getElementById('config-notice');
        if (notice) notice.hidden = false;
    }

    window.loginGeoportal = async function (email, password) {
        const message = document.getElementById('login-message');
        message.textContent = 'Entrando…';
        try {
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                console.error('Erro no login:', error);
                if (error.message && error.message.toLowerCase().includes('confirm')) {
                    message.textContent = 'E-mail não confirmado. Verifique seu e-mail ou confirme no Supabase.';
                } else {
                    message.textContent = 'E-mail ou senha inválidos.';
                }
                return;
            }
            const user = data.user;
            const redirected = await redirectByRole(user);
            if (!redirected) {
                message.textContent = 'Autenticado, mas não foi possível carregar a permissão do usuário.';
            }
        } catch (err) {
            console.error('Exceção ao autenticar:', err);
            message.textContent = 'Erro ao conectar ao serviço de autenticação.';
        }
    };

    window.logoutGeoportal = async function () {
        await window.supabaseClient?.auth.signOut();
        window.location.replace('./index.html');
    };
})();
