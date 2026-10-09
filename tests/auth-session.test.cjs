const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../auth.js'), 'utf8');
const user = { id: 'user-1', email: 'user@example.test', email_confirmed_at: '2026-10-08T12:00:00Z' };
const session = { user, access_token: 'test-token', refresh_token: 'test-refresh' };
let tabCounter = 0;

function run({ page = 'portal', sessionMap = new Map(), initialSession, role = 'visualizador',
    profileError = false, userError = false, loginError, offlineLogout = false, storageBlocked = false,
    hash = '', resetError, recoveryError, updateError,
    suppliedUser = user, configured = true, failProfile = false, navigation = 'reload',
    farms = [{code:'FE',name:'Esperança'}], farmError = false, chosenFarm = 'FE', fetchImpl,
    localMap = new Map([['sb-example-auth-token', JSON.stringify(session)], ['geoportal_calcario_records_v1', 'preserved']]) } = {}) {
    const elements = new Map(), classes = new Set(['portal-loading']), redirects = [], listeners = {};
    const storage = map => ({ getItem: key => map.get(key) || null,
        setItem(key, value) { if (storageBlocked) throw Error('blocked'); map.set(key, value); }, removeItem: key => map.delete(key) });
    const sessionStorage = storage(sessionMap);
    function element() {
        return { textContent: '', value: 'typed-password', disabled: false, hidden: false, children: [],
            classList: { toggle() {} }, remove() { this.removed = true; }, addEventListener() {},
            replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, add() {} };
    }
    const document = { body: { dataset: { page } }, documentElement: { classList: {
        add: c => classes.add(c), remove: c => classes.delete(c) } },
        createElement: () => element(),
        getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
    const calls = { getUser: 0, signOut: [], signIn: [], signUp: [], profile: 0, reset: [], setSession: [], update: [] };
    let clientOptions, authCallback;
    const window = {
        fetch: fetchImpl,
        GEO_PORTAL_CONFIG: configured ? { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-test-key' } : {},
        sessionStorage, localStorage: storage(localMap), crypto: { randomUUID: () => `tab-${++tabCounter}` },
        performance: { getEntriesByType: () => [{ type: navigation }] },
        location: { href: 'https://example.test/index.html', pathname: '/index.html', hash, search: '', replace: url => redirects.push(url), reload: () => redirects.push('reload') },
        history: { replaceState(){window.location.hash='';} },
        addEventListener(event, fn) { listeners[event] = fn; },
        supabase: { createClient(url, key, options) {
            clientOptions = options;
            const read = () => JSON.parse(sessionStorage.getItem(options.auth.storageKey) || 'null');
            if (initialSession) sessionStorage.setItem(options.auth.storageKey, JSON.stringify(initialSession));
            if (initialSession && chosenFarm) sessionStorage.setItem(`${options.auth.storageKey}.farm`, chosenFarm);
            return {
                async rpc(name) { assert.equal(name,'list_accessible_farms_by_gleba'); return {data:farms,error:farmError ? Error('denied'):null}; },
                auth: {
                    onAuthStateChange(fn) { authCallback = fn; },
                    async resetPasswordForEmail(email,options) { calls.reset.push({email,options}); return {error:resetError}; },
                    async setSession(tokens) { calls.setSession.push(tokens); if(recoveryError)return {error:recoveryError};sessionStorage.setItem(options.auth.storageKey,JSON.stringify(session));return {data:{session},error:null}; },
                    async updateUser(attributes) { calls.update.push(attributes); return {data:{user},error:updateError}; },
                    async getSession() { return { data: { session: read() }, error: null }; },
                    async getUser() { calls.getUser++; return { data: { user: userError ? null : read()?.user }, error: userError ? Error('revoked') : null }; },
                    async signInWithPassword(credentials) {
                        calls.signIn.push(credentials);
                        if (loginError) return { data: {}, error: loginError };
                        const signedIn = { ...session, user: suppliedUser };
                        sessionStorage.setItem(options.auth.storageKey, JSON.stringify(signedIn));
                        return { data: { user: suppliedUser, session: signedIn }, error: null };
                    },
                    async signUp(credentials) { calls.signUp.push(credentials); return { data: {}, error: null }; },
                    async signOut(optionsOut) {
                        calls.signOut.push(optionsOut.scope);
                        if (offlineLogout) throw Error('offline');
                        sessionStorage.removeItem(options.auth.storageKey);
                        authCallback('SIGNED_OUT', null);
                        return { error: null };
                    }
                },
                from(table) {
                    assert.equal(table, 'profiles');
                    const query = { select() { return query; }, eq(key, id) { assert.equal(key, 'id'); assert.equal(id, suppliedUser.id); return query; },
                        async single() {
                            calls.profile++;
                            if (failProfile) throw Error('network');
                            return { data: profileError ? null : { id: suppliedUser.id, role, full_name: 'Test User' }, error: profileError ? Error('denied') : null };
                        } };
                    return query;
                }
            };
        } }
    };
    vm.runInNewContext(source, { window, document, URL, URLSearchParams, AbortController,
        setTimeout: fn => setTimeout(fn, 5), clearTimeout,
        Option: function(label,value){this.label=label;this.value=value;} });
    return { window, document, elements, classes, calls, sessionMap, localMap, redirects,
        options: () => clientOptions, emit: event => authCallback(event, null), pageShow: () => listeners.pageshow({ persisted: true }) };
}

test('sem sessão na aba exige login mesmo com token permanente antigo', async () => {
    const h = run(); assert.equal(await h.window.portalReady, false);
    assert.deepEqual(h.redirects, ['./index.html']);
    assert.equal(h.localMap.has('sb-example-auth-token'), false);
    assert.equal(h.localMap.get('geoportal_calcario_records_v1'), 'preserved');
    assert.equal(h.classes.has('portal-loading'), true);
});

test('F5 mantém sessão da aba e confirma usuário e perfil no banco', async () => {
    const h = run({ initialSession: session }); assert.equal(await h.window.portalReady, true);
    const reloaded = run({ sessionMap: h.sessionMap }); assert.equal(await reloaded.window.portalReady, true);
    assert.equal(reloaded.options().auth.storageKey, h.options().auth.storageKey);
    assert.equal(reloaded.calls.getUser, 1); assert.equal(reloaded.calls.profile, 1);
    assert.equal(reloaded.window.portalAccessRole, 'visualizador');
    assert.equal(reloaded.classes.has('portal-loading'), false);
});

test('nova aba tem chave própria e não herda login de outra aba', async () => {
    const h = run({ initialSession: session }); await h.window.portalReady;
    const fresh = run(); assert.equal(await fresh.window.portalReady, false);
    assert.notEqual(fresh.options().auth.storageKey, h.options().auth.storageKey);
    assert.equal(fresh.options().auth.detectSessionInUrl, false);
    assert.equal(fresh.redirects[0], './index.html');
});

test('a página inicial sempre pede email e senha, sem redirecionar uma sessão antiga', async () => {
    const h = run({ page: 'login', initialSession: session }); await h.window.portalReady;
    assert.equal(h.redirects.length, 0); assert.deepEqual(h.calls.signOut, ['local']);
    assert.equal(h.sessionMap.has(h.options().auth.storageKey), false);
});

test('credenciais válidas pedem uma fazenda liberada antes de entrar e apagam senha do formulário', async () => {
    const h = run({ page: 'login', role: 'projetista', farms: [{code:'FE',name:'Esperança',gleba:'FE'}, {code:'FE2',name:'Esperança 2',gleba:'FE'}] }); await h.window.portalReady;
    assert.equal(await h.window.loginGeoportal(' user@example.test ', 'Fixture-password!'), true);
    assert.equal(h.calls.signIn[0].email, 'user@example.test');
    assert.equal(h.redirects.length, 0);
    assert.equal(await h.window.choosePortalFarm('Y'), false);
    assert.equal(h.redirects.length, 0);
    assert.equal(await h.window.choosePortalFarm('FE'), true);
    assert.equal(h.redirects[0], './portal.html');
    assert.equal(h.document.getElementById('password').value, '');
    assert.equal(h.sessionMap.has(h.options().auth.storageKey), true);
    assert.equal(h.localMap.has(h.options().auth.storageKey), false);
});

test('senha incorreta e e-mail não confirmado não liberam o mapa', async () => {
    for (const loginError of [{ code: 'invalid_credentials' }, { code: 'email_not_confirmed' }, { status: 429 }]) {
        const h = run({ page: 'login', loginError }); await h.window.portalReady;
        assert.equal(await h.window.loginGeoportal(user.email, 'Wrong-test-password!'), false);
        assert.equal(h.redirects.length, 0);
        assert.equal(h.document.getElementById('btn-login').disabled, false);
        assert.notEqual(h.document.getElementById('login-message').textContent, '');
    }
});

test('tentativa de conta inexistente oferece cadastro sem revelar se o email existe', async () => {
    const h = run({ page: 'login', loginError: { code: 'invalid_credentials' } });
    await h.window.loginGeoportal('missing@example.test', 'Fixture-password!');
    assert.match(h.document.getElementById('login-message').textContent, /solicite seu cadastro/);
    assert.equal(h.redirects.length, 0);
});

test('requisição sem resposta é cancelada e não fica pendurada', async () => {
    const h = run({ page: 'login', fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) });
    await h.window.portalReady;
    await assert.rejects(h.options().global.fetch('https://example.test'), /aborted/);
});

test('sinal de cancelamento do chamador também cancela o transporte', async () => {
    const h = run({ page: 'login', fetchImpl: async (url, { signal }) => {
        assert.equal(signal.aborted, true);
        throw new Error('aborted');
    } });
    await h.window.portalReady;
    const controller = new AbortController(); controller.abort();
    await assert.rejects(h.options().global.fetch('https://example.test', { signal: controller.signal }), /aborted/);
});

test('ausência de perfil nunca promove alguém a administrador pelo e-mail', async () => {
    const adminEmail = { ...user, email: 'enzo.oliveira@grupomichels.com.br' };
    const h = run({ page: 'login', suppliedUser: adminEmail, profileError: true }); await h.window.portalReady;
    assert.equal(await h.window.loginGeoportal(adminEmail.email, 'Fixture-password!'), false);
    assert.equal(h.sessionMap.has(h.options().auth.storageKey), false);
    assert.equal(h.window.portalAccessRole, undefined);
    assert.equal(h.redirects.length, 0);
});

test('sessão revogada, perfil inválido e falha no banco bloqueiam acesso', async () => {
    for (const options of [{ userError: true }, { role: 'unknown' }, { profileError: true }, { failProfile: true }]) {
        const h = run({ initialSession: session, ...options }); assert.equal(await h.window.portalReady, false);
        assert.equal(h.classes.has('portal-loading'), true);
        assert.match(h.redirects[0], /index.html\?erro=/);
        assert.equal(h.sessionMap.has(h.options().auth.storageKey), false);
    }
});

test('Sair apaga sessão local mesmo offline e não apaga dados agrícolas', async () => {
    const h = run({ initialSession: session, offlineLogout: true }); await h.window.portalReady;
    await h.window.logoutGeoportal();
    assert.deepEqual(h.calls.signOut, ['local']);
    assert.equal(h.sessionMap.has(h.options().auth.storageKey), false);
    assert.equal(h.classes.has('portal-loading'), true);
    assert.equal(h.window.portalUser, null);
    assert.equal(h.localMap.get('geoportal_calcario_records_v1'), 'preserved');
    assert.equal(h.redirects.at(-1), './index.html');
});

test('evento de saída e página restaurada pelo botão Voltar bloqueiam o conteúdo', async () => {
    const h = run({ initialSession: session }); await h.window.portalReady;
    h.emit('SIGNED_OUT'); assert.match(h.redirects[0], /erro=sessao/);
    const restored = run({ initialSession: session }); await restored.window.portalReady;
    restored.pageShow(); assert.equal(restored.redirects[0], 'reload');
    assert.equal(restored.classes.has('portal-loading'), true);
});

test('configuração ausente e armazenamento bloqueado não liberam acesso', async () => {
    for (const options of [{ configured: false }, { storageBlocked: true }]) {
        const h = run(options); assert.equal(await h.window.portalReady, false);
        assert.match(h.redirects[0], /erro=acesso/);
    }
});

test('login aceita senha antiga somente numérica e consulta o banco sem impor complexidade', async () => {
    for (const password of ['123456', '1234', 'somenteletras', 'SemEspecial123']) {
        const h = run({ page: 'login' }); await h.window.portalReady;
        assert.equal(await h.window.loginGeoportal(user.email, password), true);
        assert.equal(h.calls.signIn.length, 1);
        assert.equal(h.calls.signIn[0].password, password);
    }
    const h = run({ page: 'login' }); await h.window.portalReady;
    assert.equal(await h.window.loginGeoportal(user.email, ''), false);
    assert.equal(h.calls.signIn.length, 0);
    assert.match(h.document.getElementById('login-message').textContent, /Informe sua senha/);
});

test('cadastro aceita seis números, pede confirmação e não concede acesso automaticamente', async () => {
    const h = run({ page: 'login' }); await h.window.portalReady;
    assert.equal(await h.window.registerGeoportal('User', user.email, '123456', 'FE'), true);
    assert.equal(h.calls.signUp[0].password, '123456');
    assert.equal(h.calls.signUp[0].options.data.requested_farm, 'FE');
    assert.equal(h.redirects.length, 0);
    assert.match(h.document.getElementById('login-message').textContent, /confirmar o e-mail.*liberação/);
    assert.equal(await h.window.registerGeoportal('User', user.email, '12345', 'FE'), false);
    assert.equal(h.calls.signUp.length, 1);
});

test('abrir por endereço ou restaurar aba exige login; encaminhamento após login funciona uma vez', async () => {
    const h = run({ initialSession: session }); await h.window.portalReady;
    for (const navigation of ['navigate', 'back_forward']) {
        const reopened = run({ sessionMap: new Map(h.sessionMap), navigation });
        assert.equal(await reopened.window.portalReady, false);
        assert.equal(reopened.redirects[0], './index.html');
    }
    const login = run({ page: 'login' }); await login.window.portalReady;
    await login.window.loginGeoportal(user.email, 'Fixture-password!');
    await login.window.choosePortalFarm('FE');
    const portal = run({ sessionMap: login.sessionMap, navigation: 'navigate' });
    assert.equal(await portal.window.portalReady, true);
    const revisit = run({ sessionMap: login.sessionMap, navigation: 'navigate' });
    assert.equal(await revisit.window.portalReady, false);
});

test('nenhuma fazenda liberada ou falha ao consultar fazendas impede entrada', async () => {
    for (const options of [{farms:[]},{farmError:true}]) {
        const h=run({page:'login',...options});await h.window.portalReady;
        assert.equal(await h.window.loginGeoportal(user.email,'Fixture-password!'),false);
        assert.equal(h.redirects.length,0);assert.equal(h.sessionMap.has(h.options().auth.storageKey),false);
    }
});
test('e-mail sem confirmação e fazenda adulterada não abrem o mapa',async()=>{
    const unconfirmed=run({initialSession:{...session,user:{...user,email_confirmed_at:null}}});
    assert.equal(await unconfirmed.window.portalReady,false);assert.match(unconfirmed.redirects[0],/erro=email/);
    const other=run({initialSession:session,chosenFarm:'FE2'});
    assert.equal(await other.window.portalReady,false);assert.match(other.redirects[0],/erro=fazenda/);
});

test('única fazenda entra direto e preferência não substitui o login', async () => {
    const h = run({page:'login'});
    assert.equal(await h.window.loginGeoportal(user.email, '123456'), true);
    assert.deepEqual(h.redirects, ['./portal.html']);
    assert.equal(h.localMap.get('geoportal.preference.example.user-1.farm'), 'FE');
    const next = run({page:'login', localMap:h.localMap});
    await next.window.portalReady;
    assert.equal(next.redirects.length, 0);
    assert.equal(next.calls.signIn.length, 0);
});

test('última fazenda liberada entra direto; revogação e outra conta exigem escolha', async () => {
    const farms = [{code:'FE',name:'Esperança',gleba:'FE'}, {code:'FE2',name:'Esperança 2',gleba:'FE'}];
    const localMap = new Map([['geoportal.preference.example.user-1.farm','FE2']]);
    const valid = run({page:'login', farms, localMap});
    await valid.window.loginGeoportal(user.email, '123456');
    assert.equal(valid.redirects[0], './portal.html');
    assert.equal(valid.sessionMap.get(`${valid.options().auth.storageKey}.farm`), 'FE2');
    const revoked = run({page:'login', farms:[farms[0], {code:'FPAR',name:'Paraíso',gleba:'FPAR'}], localMap});
    await revoked.window.loginGeoportal(user.email, '123456');
    assert.equal(revoked.redirects.length, 0);
    const other = run({page:'login', farms, localMap, suppliedUser:{...user,id:'user-2'}});
    await other.window.loginGeoportal(user.email, '123456');
    assert.equal(other.redirects.length, 0);
});

test('lista agrupa fazendas pela gleba real, mantendo cada código separado', async () => {
    const h = run({page:'login', farms:[{code:'FPAR',name:'Paraíso',gleba:'FPAR'},
        {code:'FE2',name:'Esperança 2',gleba:'FE'}, {code:'FE',name:'Esperança',gleba:'FE'}]});
    await h.window.loginGeoportal(user.email, '123456');
    const groups = h.elements.get('login-farm').children;
    assert.deepEqual(Array.from(groups, group => group.label), ['Gleba FE','Gleba FPAR']);
    assert.deepEqual(Array.from(groups[0].children, option => option.value), ['FE','FE2']);
});

test('recuperação solicita link para endereço oficial sem revelar existência da conta', async () => {
    const h=run({page:'login'});await h.window.portalReady;
    assert.equal(await h.window.requestPasswordReset(' user@example.test '),true);
    assert.equal(h.calls.reset[0].email,'user@example.test');
    assert.equal(h.calls.reset[0].options.redirectTo,'https://nexa-gm.vercel.app/index.html');
    assert.match(h.elements.get('login-message').textContent,/Se este e-mail estiver cadastrado/);
    assert.equal(h.calls.signIn.length,0);assert.equal(h.calls.update.length,0);
    assert.equal(await h.window.requestPasswordReset('inválido'),false);assert.equal(h.calls.reset.length,1);
});
test('falha no envio de recuperação permite tentar novamente sem confirmar envio', async () => {
    const h=run({page:'login',resetError:{status:429}});await h.window.portalReady;
    assert.equal(await h.window.requestPasswordReset('user@example.test'),false);
    assert.match(h.elements.get('login-message').textContent,/Aguarde/);
    assert.equal(h.elements.get('btn-send-password-reset').disabled,false);
});
test('link de recuperação limpa tokens da URL, valida identidade e não abre o portal', async () => {
    const h=run({page:'login',hash:'#type=recovery&access_token=test-token&refresh_token=test-refresh'});
    assert.equal(await h.window.portalReady,false);assert.equal(h.window.location.hash,'');
    assert.equal(h.calls.setSession.length,1);assert.equal(h.calls.getUser,1);
    assert.equal(h.elements.get('new-password-form').hidden,false);
    assert.equal(h.elements.get('login-form').hidden,true);
    assert.deepEqual(h.redirects,[]);assert.equal(h.window.portalAccessRole,undefined);
    assert.equal(await h.window.saveRecoveredPassword('123','123'),false);
    assert.equal(await h.window.saveRecoveredPassword('123456','654321'),false);
    assert.equal(h.calls.update.length,0);
    assert.equal(await h.window.saveRecoveredPassword('123456','123456'),true);
    assert.equal(h.calls.update[0].password,'123456');
    assert.equal(h.sessionMap.has(h.options().auth.storageKey),false);
    assert.equal(h.elements.get('new-password').value,'');assert.equal(h.elements.get('confirm-password').value,'');
    assert.equal(h.elements.get('login-form').hidden,false);assert.deepEqual(h.redirects,[]);
});
test('link inválido e sessão comum não permitem alterar senha pelo fluxo de recuperação', async () => {
    const invalid=run({page:'login',hash:'#type=recovery&access_token=test-token&refresh_token=test-refresh',recoveryError:Error('expired')});
    await invalid.window.portalReady;assert.match(invalid.elements.get('login-message').textContent,/inválido ou expirou/);
    assert.equal(await invalid.window.saveRecoveredPassword('123456','123456'),false);assert.equal(invalid.calls.update.length,0);
    const ordinary=run({page:'login',initialSession:session});await ordinary.window.portalReady;
    assert.equal(await ordinary.window.saveRecoveredPassword('123456','123456'),false);assert.equal(ordinary.calls.update.length,0);
});
test('F5 retoma recuperação validada e falha ao salvar não apresenta sucesso', async () => {
    const h=run({page:'login',hash:'#type=recovery&access_token=test-token&refresh_token=test-refresh'});await h.window.portalReady;
    const again=run({page:'login',sessionMap:h.sessionMap,updateError:{code:'same_password'}});await again.window.portalReady;
    assert.equal(again.elements.get('new-password-form').hidden,false);
    assert.equal(await again.window.saveRecoveredPassword('123456','123456'),false);
    assert.match(again.elements.get('login-message').textContent,/diferente da anterior/);
    assert.equal(again.elements.get('btn-save-password').disabled,false);
});
