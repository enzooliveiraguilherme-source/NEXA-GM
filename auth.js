(function () {
    'use strict';
    const config = window.GEO_PORTAL_CONFIG || {};
    const isLoginPage = document.body?.dataset.page === 'login';
    const roles = ['admin', 'projetista', 'visualizador'];
    let storageKey;
    let redirecting = false;
    let loginPending = false;
    let recoveryReady = false;
    let passwordPurpose = 'recovery';
    let allowedFarms = [];
    let preferencePrefix;

    function rememberedFarm(user) {
        try { return window.localStorage.getItem(`${preferencePrefix}.${user.id}.farm`); }
        catch (_) { return null; }
    }

    function rememberFarm(user, code) {
        // Guarda somente a preferência. As permissões são conferidas novamente no banco.
        try { window.localStorage.setItem(`${preferencePrefix}.${user.id}.farm`, code); }
        catch (_) { /* A escolha continua disponível para esta sessão. */ }
    }

    function enterFarm(user, code) {
        rememberFarm(user, code);
        window.sessionStorage.setItem(`${storageKey}.farm`, code);
        window.sessionStorage.setItem(`${storageKey}.entry`, '1');
        window.location.replace('./portal.html');
        return true;
    }

    function setMessage(text) {
        const message = document.getElementById('login-message') || document.getElementById('farm-switch-message');
        if (message) message.textContent = text;
    }

    window.populateFarmChoices = function (select, farms, selected) {
        select.replaceChildren();
        const groups = new Map();
        [...farms].sort((a, b) => (a.gleba || '').localeCompare(b.gleba || '', 'pt-BR') ||
            a.name.localeCompare(b.name, 'pt-BR') || a.code.localeCompare(b.code)).forEach(farm => {
            const label = farm.gleba ? `Gleba ${farm.gleba}` : 'Sem gleba cadastrada';
            if (!groups.has(label)) {
                const group = document.createElement('optgroup');
                group.label = label;
                groups.set(label, group);
                select.appendChild(group);
            }
            groups.get(label).appendChild(new Option(`${farm.name} (${farm.code})`, farm.code));
        });
        if (farms.some(farm => farm.code === selected)) select.value = selected;
    };

    function lockAccess() {
        document.documentElement.classList.add('portal-loading');
        window.portalProfile = null;
        window.portalAccessRole = null;
        window.portalUser = null;
    }

    function goToLogin(reason = '') {
        if (isLoginPage || redirecting) return;
        redirecting = true;
        lockAccess();
        window.location.replace(`./index.html${reason ? `?erro=${reason}` : ''}`);
    }

    function clearSession() {
        if (!storageKey) return;
        try {
            window.sessionStorage.removeItem(storageKey);
            window.sessionStorage.removeItem(`${storageKey}-user`);
            window.sessionStorage.removeItem(`${storageKey}.entry`);
            window.sessionStorage.removeItem(`${storageKey}.farm`);
            window.sessionStorage.removeItem(`${storageKey}.recovery`);
        } catch (_) { /* O acesso continua bloqueado se o armazenamento estiver indisponível. */ }
    }

    async function endSession() {
        try {
            // Encerra apenas este acesso, sem desconectar outros dispositivos.
            await window.supabaseClient?.auth.signOut({ scope: 'local' });
        } finally {
            clearSession();
        }
    }

    async function getProfile(user) {
        const { data, error } = await window.supabaseClient.from('profiles')
            .select('id, full_name, role, all_farms').eq('id', user.id).single();
        // Somente o cadastro do banco define a permissão; e-mail e URL não concedem acesso.
        if (error || !data || data.id !== user.id || !roles.includes(data.role)) return null;
        return data;
    }

    function showRecovery(active) {
        for (const id of ['login-form', 'invite-only-help', 'btn-forgot-password']) {
            const element = document.getElementById(id); if (element) element.hidden = active;
        }
        document.getElementById('password-request-form').hidden = true;
        document.getElementById('new-password-form').hidden = !active;
        document.getElementById('login-title').textContent = active ? (passwordPurpose === 'invite' ? 'Crie sua senha de acesso' : 'Defina sua nova senha') : 'Bem-vindo ao Geoportal';
        document.getElementById('btn-save-password').textContent = active && passwordPurpose === 'invite' ? 'Criar senha e concluir convite' : 'Salvar nova senha';
        document.getElementById('login-intro').textContent = active ? 'Use ao menos 6 caracteres. Pode ser somente números. Confirme a senha abaixo.' : 'Entre com seu acesso corporativo para continuar.';
    }

    function showAccount(profile, user) {
        window.portalProfile = profile;
        window.portalAccessRole = profile.role;
        window.portalUser = user;
        document.body.dataset.accessRole = profile.role;
        const name = document.getElementById('portal-account-name');
        if (name) name.textContent = profile.full_name || user.email;
        const role = document.getElementById('portal-account-role');
        if (role) role.textContent = `${window.portalFarm.gleba ? `Gleba ${window.portalFarm.gleba} · ` : ''}${window.portalFarm.name} · ${ { admin: 'Administrador', projetista: 'Projetista', visualizador: 'Visualizador' }[profile.role] }`;
        const switchButton = document.getElementById('btn-switch-farm');
        if (switchButton) switchButton.hidden = allowedFarms.length < 2;
        const farmFilters = document.getElementById('farm-filter-section');
        if (farmFilters) {
            farmFilters.hidden = allowedFarms.length < 2;
            farmFilters.classList.toggle('hidden', allowedFarms.length < 2);
        }
        document.getElementById('admin-view-switch')?.classList.toggle('hidden', profile.role !== 'admin');
        document.documentElement.classList.remove('portal-loading');
        document.getElementById('auth-loading-overlay')?.remove();
    }

    async function getFarms() {
        const { data, error } = await window.supabaseClient.rpc('list_accessible_farms_by_gleba');
        if (error || !Array.isArray(data)) throw new Error('Não foi possível consultar as fazendas liberadas.');
        return data;
    }

    window.portalReady = (async () => {
        if (!config.supabaseUrl || !config.supabaseAnonKey || config.supabaseUrl.includes('COLE_AQUI') ||
            config.supabaseAnonKey.includes('COLE_AQUI') || !window.supabase) {
            if (isLoginPage) {
                const notice = document.getElementById('config-notice');
                if (notice) notice.hidden = false;
                setMessage('O serviço de acesso está indisponível. Tente novamente mais tarde.');
            } else goToLogin('acesso');
            return false;
        }

        const project = new URL(config.supabaseUrl).hostname.split('.')[0];
        preferencePrefix = `geoportal.preference.${project}`;
        const tabKey = `geoportal.auth.${project}.tab`;
        let tabId = window.sessionStorage.getItem(tabKey);
        if (!tabId) {
            tabId = window.crypto.randomUUID();
            window.sessionStorage.setItem(tabKey, tabId);
        }
        // Uma chave por aba impede o Supabase de compartilhar login pelo BroadcastChannel.
        storageKey = `geoportal.auth.${project}.${tabId}.session.v2`;
        const entryKey = `${storageKey}.entry`;
        const loginHandoff = window.sessionStorage.getItem(entryKey) === '1';
        window.sessionStorage.removeItem(entryKey);
        const reload = window.performance?.getEntriesByType('navigation')[0]?.type === 'reload';
        if (!isLoginPage && !reload && !loginHandoff) {
            // Abrir pelo endereço, favorito ou restaurar uma aba pede login; F5 preserva o acesso.
            clearSession();
        }
        window.sessionStorage.setItem(`${storageKey}.check`, '1');
        window.sessionStorage.removeItem(`${storageKey}.check`);
        try {
            // Não reutiliza o login permanente anterior. Os dados agrícolas são preservados.
            window.localStorage.removeItem(`sb-${project}-auth-token`);
            window.localStorage.removeItem(`sb-${project}-auth-token-user`);
        } catch (_) { /* Nenhum token antigo é lido pelo cliente novo. */ }

        window.supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
            global: { fetch: async (url, options = {}) => {
                const controller = new AbortController();
                const abort = () => controller.abort();
                if (options.signal?.aborted) abort();
                options.signal?.addEventListener('abort', abort, { once: true });
                const timeout = setTimeout(abort, String(url).includes('/auth/v1/') ? 15000 : 60000);
                try { return await window.fetch(url, { ...options, signal: controller.signal }); }
                finally {
                    clearTimeout(timeout);
                    options.signal?.removeEventListener('abort', abort);
                }
            } },
            auth: { storage: window.sessionStorage, storageKey, persistSession: true,
                autoRefreshToken: true, detectSessionInUrl: false }
        });
        window.supabaseClient.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') {
                clearSession();
                goToLogin('sessao');
            }
        });

        if (isLoginPage) {
            const recovery = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
            const recoveryLink = ['recovery', 'invite'].includes(recovery.get('type'));
            const passwordMarker = window.sessionStorage.getItem(`${storageKey}.recovery`);
            const resumeRecovery = reload && ['1', 'invite'].includes(passwordMarker);
            if (recoveryLink || resumeRecovery) {
                if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
                try {
                    if (recoveryLink) {
                        clearSession();
                        if (!recovery.get('access_token') || !recovery.get('refresh_token')) throw Error('invalid');
                        const { error } = await window.supabaseClient.auth.setSession({ access_token: recovery.get('access_token'), refresh_token: recovery.get('refresh_token') });
                        if (error) throw error;
                    }
                    const { data: { user }, error } = await window.supabaseClient.auth.getUser();
                    if (error || !user) throw Error('expired');
                    passwordPurpose = recoveryLink ? recovery.get('type') : passwordMarker === 'invite' ? 'invite' : 'recovery';
                    window.sessionStorage.setItem(`${storageKey}.recovery`, passwordPurpose === 'invite' ? 'invite' : '1');
                    recoveryReady = true; showRecovery(true); setMessage('');
                } catch (_) {
                    try { await endSession(); } catch (_) { clearSession(); }
                    setMessage('O link de recuperação é inválido ou expirou. Solicite um novo em “Esqueci minha senha”.');
                }
                return false;
            }
            // A entrada sempre pede as credenciais, sem redirecionamento automático.
            await endSession();
            if (recovery.has('error') || recovery.has('error_code')) {
                window.history.replaceState(null, '', window.location.pathname);
                setMessage('O link recebido é inválido ou expirou. Solicite um novo em “Esqueci minha senha”.');
                return false;
            }
            const reason = new URLSearchParams(window.location.search).get('erro');
            setMessage({ perfil: 'Sua conta não tem um perfil de acesso válido. Solicite a liberação ao administrador.',
                sessao: 'Sua sessão foi encerrada. Entre novamente para continuar.',
                acesso: 'Não foi possível validar seu acesso. Entre novamente.',
                fazenda: 'Sua fazenda não está liberada. Solicite acesso ao administrador.',
                email: 'Confirme seu e-mail antes de entrar.' }[reason] ||
                (window.location.hash ? 'Após confirmar o e-mail, entre com sua senha. A fazenda depende da liberação do administrador.' : ''));
            // O link confirma o e-mail no Supabase. Nunca usa o token da URL para entrar automaticamente.
            if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
            return false;
        }

        const { data: { session }, error: sessionError } = await window.supabaseClient.auth.getSession();
        if (sessionError || !session) {
            clearSession(); goToLogin(); return false;
        }
        // Confirma a identidade no serviço de autenticação, não apenas no navegador.
        const { data: { user }, error: userError } = await window.supabaseClient.auth.getUser();
        if (userError || !user) {
            goToLogin('sessao'); await endSession(); return false;
        }
        if (!user.email_confirmed_at) {
            goToLogin('email'); await endSession(); return false;
        }
        const profile = await getProfile(user);
        if (!profile) {
            goToLogin('perfil'); await endSession(); return false;
        }
        allowedFarms = await getFarms();
        window.portalFarms = allowedFarms;
        const chosen = window.sessionStorage.getItem(`${storageKey}.farm`);
        window.portalFarm = allowedFarms.find(farm => farm.code === chosen);
        if (!window.portalFarm) {
            goToLogin('fazenda'); await endSession(); return false;
        }
        showAccount(profile, user);
        rememberFarm(user, window.portalFarm.code);
        return true;
    })().catch(() => {
        clearSession();
        if (isLoginPage) setMessage('Não foi possível preparar o acesso. Permita o armazenamento desta aba e tente novamente.');
        else goToLogin('acesso');
        return false;
    });

    window.loginGeoportal = async function (email, password) {
        if (loginPending) return false;
        setMessage('Preparando seu acesso…');
        await window.portalReady;
        if (recoveryReady) return false;
        if (loginPending) return false;
        if (!String(password || '').length) {
            setMessage('Informe sua senha para entrar.');
            return false;
        }
        if (!window.supabaseClient) {
            setMessage('O serviço de acesso está indisponível. Tente novamente mais tarde.'); return false;
        }
        loginPending = true;
        const button = document.getElementById('btn-login');
        if (button) { button.disabled = true; button.textContent = 'Entrando…'; }
        setMessage('Validando seu acesso…');
        try {
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email: String(email).trim(), password });
            if (error || !data?.user || !data?.session) {
                setMessage(error?.code === 'email_not_confirmed'
                    ? 'Confirme seu e-mail antes de entrar. Consulte o administrador se precisar de ajuda.'
                    : error?.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
                    : 'Não foi possível entrar. Confira seu e-mail e senha. Se ainda não tem acesso, solicite um convite ao administrador.');
                return false;
            }
            if (!data.user.email_confirmed_at) {
                await endSession(); setMessage('Confirme seu e-mail antes de entrar.'); return false;
            }
            const profile = await getProfile(data.user);
            if (!profile) {
                await endSession();
                setMessage('Sua conta não tem um perfil de acesso válido. Solicite a liberação ao administrador.'); return false;
            }
            const passwordInput = document.getElementById('password');
            if (passwordInput) passwordInput.value = '';
            allowedFarms = await getFarms();
            if (!allowedFarms.length) {
                await endSession(); setMessage('Sua conta aguarda a liberação de uma fazenda pelo administrador.'); return false;
            }
            const previous = rememberedFarm(data.user);
            const automatic = allowedFarms.find(farm => farm.code === previous) || allowedFarms[0];
            return enterFarm(data.user, automatic.code);
        } catch (_) {
            try { await endSession(); } catch (_) { clearSession(); }
            setMessage('Não foi possível conectar ao serviço de acesso. Tente novamente.'); return false;
        } finally {
            loginPending = false;
            if (button) { button.disabled = false; button.textContent = 'Entrar no geoportal'; }
        }
    };

    window.choosePortalFarm = async function (code) {
        if (loginPending) return false;
        loginPending = true;
        try {
            const { data: { user }, error } = await window.supabaseClient.auth.getUser();
            if (error || !user?.email_confirmed_at) throw new Error('Seu acesso expirou. Entre novamente.');
            const available = await getFarms();
            if (!available.some(farm => farm.code === code)) throw new Error('Esta fazenda não está liberada para sua conta.');
            return enterFarm(user, code);
        } catch (error) { setMessage(error.message); return false; }
        finally { loginPending = false; }
    };

    window.registerGeoportal = async function () {
        setMessage('O acesso é por convite. Solicite ao administrador a liberação do seu e-mail e das fazendas.');
        return false;
    };

    window.requestPasswordReset = async function (email) {
        await window.portalReady;
        if (loginPending || recoveryReady) return false;
        if (!window.supabaseClient) { setMessage('O serviço de acesso está indisponível. Tente novamente mais tarde.'); return false; }
        const address = String(email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setMessage('Informe um e-mail válido para recuperar sua senha.'); return false; }
        loginPending = true;
        const button = document.getElementById('btn-send-password-reset'); button.disabled = true;
        setMessage('Solicitando o link de recuperação…');
        try {
            const { error } = await window.supabaseClient.auth.resetPasswordForEmail(address, { redirectTo: 'https://nexa-gm.vercel.app/index.html' });
            if (error) throw error;
            setMessage('Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Confira também a caixa de spam.');
            return true;
        } catch (error) {
            setMessage(error.status === 429 ? 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' : 'Não foi possível solicitar o link. Confira sua conexão e tente novamente.');
            return false;
        } finally { loginPending = false; button.disabled = false; }
    };

    window.saveRecoveredPassword = async function (password, confirmation) {
        await window.portalReady;
        if (loginPending) return false;
        if (!recoveryReady) { setMessage('Abra o link recebido por e-mail para definir sua nova senha.'); return false; }
        if (String(password || '').length < 6) { setMessage('Use uma senha com ao menos 6 caracteres.'); return false; }
        if (password !== confirmation) { setMessage('As senhas não coincidem. Confira os dois campos.'); return false; }
        loginPending = true;
        const button = document.getElementById('btn-save-password'); button.disabled = true;
        try {
            const { data: { user }, error: userError } = await window.supabaseClient.auth.getUser();
            if (userError || !user) throw Error('expired');
            const { error } = await window.supabaseClient.auth.updateUser({ password });
            if (error) throw error;
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
            recoveryReady = false;
            try { await endSession(); } catch (_) { clearSession(); }
            showRecovery(false);
            setMessage(passwordPurpose === 'invite' ? 'Convite concluído. Entre com seu e-mail e a senha que você criou.' : 'Senha atualizada. Entre com seu e-mail e a nova senha.');
            return true;
        } catch (error) {
            setMessage(error.code === 'weak_password' ? 'A senha foi recusada pelo serviço de acesso. Tente outra senha ou consulte o administrador.'
                : error.code === 'same_password' ? 'Escolha uma senha diferente da anterior.'
                : 'Não foi possível atualizar a senha. O link pode ter expirado; solicite um novo e tente novamente.');
            return false;
        } finally { loginPending = false; button.disabled = false; }
    };
    window.cancelPasswordRecovery = async function () {
        await window.portalReady;
        if (loginPending) return;
        recoveryReady = false;
        try { await endSession(); } catch (_) { clearSession(); }
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        showRecovery(false); setMessage('');
    };

    window.logoutGeoportal = async function () {
        lockAccess();
        try { await endSession(); } catch (_) { clearSession(); }
        window.location.replace('./index.html');
    };
    document.getElementById('btn-account-menu')?.addEventListener('click', () => document.getElementById('account-menu').showModal());
    document.getElementById('btn-close-account')?.addEventListener('click', () => document.getElementById('account-menu').close());
    document.getElementById('btn-logout')?.addEventListener('click', () => window.logoutGeoportal());
    document.getElementById('btn-switch-farm')?.addEventListener('click', async () => {
        const dialog = document.getElementById('farm-switch-dialog');
        document.getElementById('account-menu')?.close();
        try {
            allowedFarms = await getFarms();
            window.populateFarmChoices(document.getElementById('switch-farm'), allowedFarms, window.portalFarm.code);
            setMessage('');
            dialog.showModal();
        } catch (_) { setMessage('Não foi possível consultar as fazendas. Tente novamente.'); dialog.showModal(); }
    });
    document.getElementById('farm-switch-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const button = document.getElementById('btn-confirm-farm');
        button.disabled = true;
        try { await window.choosePortalFarm(document.getElementById('switch-farm').value); }
        finally { button.disabled = false; }
    });
    document.getElementById('btn-cancel-farm')?.addEventListener('click', () => document.getElementById('farm-switch-dialog').close());
    window.addEventListener('pageshow', event => {
        if (event.persisted) {
            if (!isLoginPage) lockAccess();
            window.location.reload();
        }
    });
})();
