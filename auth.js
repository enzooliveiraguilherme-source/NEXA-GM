(function () {
    'use strict';
    const config = window.GEO_PORTAL_CONFIG || {};
    const isLoginPage = document.body?.dataset.page === 'login';
    const roles = ['admin', 'projetista', 'visualizador'];
    let storageKey;
    let redirecting = false;
    let loginPending = false;
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
            // A entrada sempre pede as credenciais, sem redirecionamento automático.
            await endSession();
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
                    : 'Não foi possível entrar. Confira seu e-mail e senha. Se ainda não tem uma conta, solicite seu cadastro abaixo.');
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
            const automatic = allowedFarms.length === 1 ? allowedFarms[0]
                : allowedFarms.find(farm => farm.code === previous);
            if (automatic) return enterFarm(data.user, automatic.code);
            const select = document.getElementById('login-farm');
            window.populateFarmChoices(select, allowedFarms);
            document.getElementById('login-credentials').hidden = true;
            document.getElementById('farm-choice').hidden = false;
            document.getElementById('btn-login').hidden = true;
            document.getElementById('btn-show-register').hidden = true;
            setMessage('Escolha uma fazenda para este acesso.');
            return true;
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

    window.registerGeoportal = async function (name, email, password, farm) {
        await window.portalReady;
        if (loginPending) return false;
        if (String(password || '').length < 6) {
            setMessage('Use uma senha com ao menos 6 caracteres. Pode ser somente números.'); return false;
        }
        if (!String(name).trim() || !farm) { setMessage('Informe seu nome e uma fazenda.'); return false; }
        loginPending = true;
        const button = document.getElementById('btn-register');
        button.disabled = true;
        try {
            const { error } = await window.supabaseClient.auth.signUp({ email: String(email).trim(), password,
                options: { emailRedirectTo: new URL('./index.html', window.location.href).href,
                    data: { full_name: String(name).trim(), requested_farm: farm } } });
            if (error) throw error;
            await endSession();
            document.getElementById('register-password').value = '';
            setMessage('Se o cadastro for elegível, você receberá um link para confirmar o e-mail. Após a confirmação, aguarde a liberação da fazenda pelo administrador.');
            return true;
        } catch (error) {
            setMessage(error.status === 429 ? 'Aguarde alguns minutos antes de tentar novamente.'
                : error.code === 'weak_password' ? 'Use uma senha com ao menos 6 caracteres.'
                : 'Não foi possível solicitar o cadastro. Confira os dados ou consulte o administrador.');
            return false;
        } finally { loginPending = false; button.disabled = false; }
    };

    window.logoutGeoportal = async function () {
        lockAccess();
        try { await endSession(); } catch (_) { clearSession(); }
        window.location.replace('./index.html');
    };
    document.getElementById('btn-logout')?.addEventListener('click', () => window.logoutGeoportal());
    document.getElementById('btn-switch-farm')?.addEventListener('click', async () => {
        const dialog = document.getElementById('farm-switch-dialog');
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
