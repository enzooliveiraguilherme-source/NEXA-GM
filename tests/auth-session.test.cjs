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
    hash = '', search = '', resetError, recoveryError, verifyOtpError, verifyOtpUserError = false,
    otpAlreadyUsedOnRetry = false, verifiedUser = user, updateError,
    hasPermanentPassword = true, permanentPasswordError = false,
    suppliedUser = user, configured = true, failProfile = false, navigation = 'reload',
    farms = [{code:'FE',name:'Esperança'}], farmError = false, chosenFarm = 'FE', fetchImpl,
    localMap = new Map([['sb-example-auth-token', JSON.stringify(session)], ['geoportal_calcario_records_v1', 'preserved']]) } = {}) {
    const elements = new Map(), classes = new Set(['portal-loading']), redirects = [], listeners = {};
    const storage = map => ({ getItem: key => map.get(key) || null,
        setItem(key, value) { if (storageBlocked) throw Error('blocked'); map.set(key, value); }, removeItem: key => map.delete(key) });
    const sessionStorage = storage(sessionMap);
    function element() {
        return { textContent: '', value: 'typed-password', disabled: false, hidden: false, children: [], listeners: {},
            classList: { toggle() {} }, remove() { this.removed = true; }, addEventListener(event, fn) { this.listeners[event] = fn; },
            replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, add() {} };
    }
    const document = { body: { dataset: { page } }, documentElement: { classList: {
        add: c => classes.add(c), remove: c => classes.delete(c) } },
        createElement: () => element(),
        getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
    const calls = { getUser: 0, signOut: [], signIn: [], signUp: [], profile: 0, reset: [], setSession: [], verifyOtp: [], update: [], rpc: [] };
    let clientOptions, authCallback, otpConsumed = false;
    const window = {
        fetch: fetchImpl,
        GEO_PORTAL_CONFIG: configured ? { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-test-key' } : {},
        sessionStorage, localStorage: storage(localMap), crypto: { randomUUID: () => `tab-${++tabCounter}` },
        performance: { getEntriesByType: () => [{ type: navigation }] },
        location: { href: `https://example.test/index.html${search}${hash}`, pathname: '/index.html', hash, search, replace: url => redirects.push(url), reload: () => redirects.push('reload') },
        history: { replaceState(){window.location.hash='';window.location.search='';} },
        addEventListener(event, fn) { listeners[event] = fn; },
        supabase: { createClient(url, key, options) {
            clientOptions = options;
            const read = () => JSON.parse(sessionStorage.getItem(options.auth.storageKey) || 'null');
            if (initialSession) sessionStorage.setItem(options.auth.storageKey, JSON.stringify(initialSession));
            if (initialSession && chosenFarm) sessionStorage.setItem(`${options.auth.storageKey}.farm`, chosenFarm);
            return {
                async rpc(name, args) {
                    calls.rpc.push({name,args});
                    if(name === 'has_permanent_password') return {data:hasPermanentPassword,error:permanentPasswordError ? Error('denied'):null};
                    assert.equal(name,'list_accessible_farms_by_gleba'); return {data:farms,error:farmError ? Error('denied'):null};
                },
                auth: {
                    onAuthStateChange(fn) { authCallback = fn; },
                    async resetPasswordForEmail(email,options) { calls.reset.push({email,options}); return {error:resetError}; },
                    async setSession(tokens) { calls.setSession.push(tokens); if(recoveryError)return {error:recoveryError};sessionStorage.setItem(options.auth.storageKey,JSON.stringify(session));return {data:{session},error:null}; },
                    async verifyOtp(params) { calls.verifyOtp.push({ ...params }); if(verifyOtpError || (otpConsumed && otpAlreadyUsedOnRetry))return {data:{},error:verifyOtpError || Error('OTP already used')};otpConsumed=true;const verifiedSession={...session,user:verifiedUser};sessionStorage.setItem(options.auth.storageKey,JSON.stringify(verifiedSession));return {data:{user:verifiedUser,session:verifiedSession},error:null}; },
                    async updateUser(attributes) { calls.update.push({ ...attributes }); return {data:{user},error:updateError}; },
                    async getSession() { return { data: { session: read() }, error: null }; },
                    async getUser() { calls.getUser++; const failed = userError || (verifyOtpUserError && otpConsumed); return { data: { user: failed ? null : read()?.user }, error: failed ? Error('revoked') : null }; },
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

test('credenciais válidas entram direto na primeira fazenda liberada e apagam a senha', async () => {
    const h = run({ page: 'login', role: 'projetista', farms: [{code:'FE',name:'Esperança',gleba:'FE'}, {code:'FE2',name:'Esperança 2',gleba:'FE'}] }); await h.window.portalReady;
    assert.equal(await h.window.loginGeoportal(' user@example.test ', 'Fixture-password!'), true);
    assert.equal(h.calls.signIn[0].email, 'user@example.test');
    assert.deepEqual(h.redirects, ['./portal.html']);
    assert.equal(h.sessionMap.get(`${h.options().auth.storageKey}.farm`), 'FE');
    assert.equal(await h.window.choosePortalFarm('Y'), false);
    assert.equal(h.redirects.length, 1);
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

test('tentativa de conta inexistente orienta convite sem revelar se o email existe', async () => {
    const h = run({ page: 'login', loginError: { code: 'invalid_credentials' } });
    await h.window.loginGeoportal('missing@example.test', 'Fixture-password!');
    assert.match(h.document.getElementById('login-message').textContent, /solicite um convite/);
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

test('cadastro público não cria conta e orienta convite do administrador', async () => {
 const h=run({page:'login'}); await h.window.portalReady;
 assert.equal(await h.window.registerGeoportal('User',user.email,'123456','FE'),false);
 assert.equal(h.calls.signUp.length,0);
 assert.match(h.document.getElementById('login-message').textContent,/convite/);
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

test('última fazenda entra direto; preferência revogada ou de outra conta usa a primeira liberada', async () => {
    const farms = [{code:'FE',name:'Esperança',gleba:'FE'}, {code:'FE2',name:'Esperança 2',gleba:'FE'}];
    const localMap = new Map([['geoportal.preference.example.user-1.farm','FE2']]);
    const valid = run({page:'login', farms, localMap});
    await valid.window.loginGeoportal(user.email, '123456');
    assert.equal(valid.redirects[0], './portal.html');
    assert.equal(valid.sessionMap.get(`${valid.options().auth.storageKey}.farm`), 'FE2');
    const revoked = run({page:'login', farms:[farms[0], {code:'FPAR',name:'Paraíso',gleba:'FPAR'}], localMap});
    await revoked.window.loginGeoportal(user.email, '123456');
    assert.deepEqual(revoked.redirects, ['./portal.html']);
    assert.equal(revoked.sessionMap.get(`${revoked.options().auth.storageKey}.farm`), 'FE');
    const other = run({page:'login', farms, localMap, suppliedUser:{...user,id:'user-2'}});
    await other.window.loginGeoportal(user.email, '123456');
    assert.deepEqual(other.redirects, ['./portal.html']);
    assert.equal(other.sessionMap.get(`${other.options().auth.storageKey}.farm`), 'FE');
});

test('lista agrupa fazendas pela gleba real, mantendo cada código separado', async () => {
    const farms = [{code:'FPAR',name:'Paraíso',gleba:'FPAR'},
        {code:'FE2',name:'Esperança 2',gleba:'FE'}, {code:'FE',name:'Esperança',gleba:'FE'}];
    const h = run({initialSession:session,farms}); await h.window.portalReady;
    const select = h.document.getElementById('switch-farm');
    h.window.populateFarmChoices(select, farms);
    const groups = select.children;
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
    assert.equal(await h.window.saveRecoveredPassword('12345678','87654321'),false);
    assert.equal(h.calls.update.length,0);
    assert.equal(await h.window.saveRecoveredPassword('12345678','12345678'),true);
    assert.equal(h.calls.update[0].password,'12345678');
    assert.equal(h.sessionMap.has(h.options().auth.storageKey),false);
    assert.equal(h.elements.get('new-password').value,'');assert.equal(h.elements.get('confirm-password').value,'');
    assert.equal(h.elements.get('login-form').hidden,false);assert.deepEqual(h.redirects,[]);
});
test('link inválido e sessão comum não permitem alterar senha pelo fluxo de recuperação', async () => {
    const invalid=run({page:'login',hash:'#type=recovery&access_token=test-token&refresh_token=test-refresh',recoveryError:Error('expired')});
    await invalid.window.portalReady;assert.match(invalid.elements.get('login-message').textContent,/inválido ou expirou/);
    assert.equal(await invalid.window.saveRecoveredPassword('12345678','12345678'),false);assert.equal(invalid.calls.update.length,0);
    const ordinary=run({page:'login',initialSession:session});await ordinary.window.portalReady;
    assert.equal(await ordinary.window.saveRecoveredPassword('12345678','12345678'),false);assert.equal(ordinary.calls.update.length,0);
});
test('F5 retoma recuperação validada e falha ao salvar não apresenta sucesso', async () => {
    const h=run({page:'login',hash:'#type=recovery&access_token=test-token&refresh_token=test-refresh'});await h.window.portalReady;
    const again=run({page:'login',sessionMap:h.sessionMap,updateError:{code:'same_password'}});await again.window.portalReady;
    assert.equal(again.elements.get('new-password-form').hidden,false);
    assert.equal(await again.window.saveRecoveredPassword('12345678','12345678'),false);
    assert.match(again.elements.get('login-message').textContent,/diferente da anterior/);
    assert.equal(again.elements.get('btn-save-password').disabled,false);
});
test('convite abre criação de senha sem entrar no portal e mantém fluxo após F5', async () => {
 const h=run({page:'login',hash:'#type=invite&access_token=invite-token&refresh_token=invite-refresh'}); await h.window.portalReady;
 assert.equal(h.document.getElementById('login-title').textContent,'Crie sua senha de acesso');
 assert.equal(h.calls.profile,0);assert.equal(h.redirects.length,0);assert.equal(h.window.location.hash,'');
 const reload=run({page:'login',sessionMap:h.sessionMap}); await reload.window.portalReady;
 assert.equal(reload.document.getElementById('login-title').textContent,'Crie sua senha de acesso');
 assert.equal(await reload.window.saveRecoveredPassword('12345678','12345678'),true);
 assert.match(reload.document.getElementById('login-message').textContent,/Convite concluído/);
 assert.equal(reload.redirects.length,0);
});
test('link de convite ou recuperação só prepara confirmação; scanner não consome o token', async () => {
 for (const type of ['invite','recovery']) {
  const search=`?token_hash=hash-${type}&type=${type}`;
  const h=run({page:'login',search}); await h.window.portalReady;
  assert.equal(h.calls.verifyOtp.length,0); assert.equal(h.calls.setSession.length,0);
  assert.equal(h.calls.update.length,0);
  assert.deepEqual(h.sessionMap.has(h.options().auth.storageKey),false);
  assert.equal(h.document.getElementById('email-link-confirmation').hidden,false);
  assert.equal(h.document.getElementById('btn-accept-invite').hidden,false);
  assert.equal(h.document.getElementById('new-password-form').hidden,true);
  assert.equal(h.window.location.search,'');
  assert.deepEqual(JSON.parse(h.sessionMap.get(`${h.options().auth.storageKey}.email-link`)),{token_hash:`hash-${type}`,type});
 }
});
test('aceitação explícita verifica o hash uma vez, confirma usuário e só então permite criar senha', async () => {
 const h=run({page:'login',search:'?token_hash=invite-hash&type=invite'}); await h.window.portalReady;
 assert.equal(await h.window.acceptEmailLink(),true);
 assert.deepEqual(h.calls.verifyOtp,[{token_hash:'invite-hash',type:'invite'}]);
 assert.equal(h.calls.getUser,1); assert.equal(h.document.getElementById('new-password-form').hidden,false);
 assert.equal(h.document.getElementById('login-title').textContent,'Crie sua senha de acesso');
 assert.equal(h.sessionMap.has(`${h.options().auth.storageKey}.email-link`),false);
 assert.equal(h.calls.update.length,0);
 assert.equal(await h.window.saveRecoveredPassword('12345678','12345678'),true);
    assert.deepEqual(h.calls.update,[{password:'12345678'}]);
});
test('pending link sobrevive F5 e chamadas simultâneas não verificam duas vezes', async () => {
 const h=run({page:'login',search:'?token_hash=reset-hash&type=recovery'}); await h.window.portalReady;
 const again=run({page:'login',sessionMap:h.sessionMap}); await again.window.portalReady;
 assert.equal(again.document.getElementById('email-link-confirmation').hidden,false);
 assert.equal(again.document.getElementById('new-password-form').hidden,true);
 await Promise.all([again.window.acceptEmailLink(),again.window.acceptEmailLink()]);
 assert.equal(again.calls.verifyOtp.length,1);
 assert.deepEqual(again.calls.verifyOtp[0],{token_hash:'reset-hash',type:'recovery'});
 assert.equal(again.document.getElementById('new-password-form').hidden,false);
});
test('tipo inválido não verifica OTP e cancelar apaga link pendente', async () => {
 for (const search of ['?token_hash=bad&type=signup','?token_hash=&type=invite','?token_hash=bad']) {
  const invalid=run({page:'login',search}); await invalid.window.portalReady;
  assert.equal(invalid.calls.verifyOtp.length,0);
  assert.equal(invalid.document.getElementById('email-link-confirmation').hidden,true);
  assert.equal(invalid.document.getElementById('new-password-form').hidden,true);
 }
 const h=run({page:'login',search:'?token_hash=invite-hash&type=invite'}); await h.window.portalReady;
 await h.window.cancelPasswordRecovery();
 assert.equal(h.calls.verifyOtp.length,0);
 assert.equal(h.sessionMap.has(`${h.options().auth.storageKey}.email-link`),false);
 assert.equal(h.sessionMap.has(`${h.options().auth.storageKey}.recovery`),false);
 assert.equal(h.document.getElementById('email-link-confirmation').hidden,true);
});
test('falha na verificação OTP mantém confirmação para nova tentativa e não libera senha', async () => {
 const h=run({page:'login',search:'?token_hash=expired-hash&type=invite',verifyOtpError:Error('expired')}); await h.window.portalReady;
 assert.equal(await h.window.acceptEmailLink(),false);
 assert.deepEqual(h.calls.verifyOtp,[{token_hash:'expired-hash',type:'invite'}]);
 assert.equal(h.document.getElementById('email-link-confirmation').hidden,false);
 assert.equal(h.document.getElementById('new-password-form').hidden,true);
 assert.ok(h.sessionMap.has(`${h.options().auth.storageKey}.email-link`));
 assert.match(h.document.getElementById('login-message').textContent,/inválido ou expirou/);
});
test('OTP sem usuário confirmado não libera a criação de senha', async () => {
 for (const options of [{userError:true},{verifiedUser:{...user,email_confirmed_at:null}}]) {
  const h=run({page:'login',search:'?token_hash=valid-hash&type=invite',...options}); await h.window.portalReady;
  assert.equal(await h.window.acceptEmailLink(),false);
  assert.equal(h.calls.verifyOtp.length,1);
  assert.equal(h.document.getElementById('email-link-confirmation').hidden,false);
  assert.equal(h.document.getElementById('new-password-form').hidden,true);
  assert.ok(h.sessionMap.has(`${h.options().auth.storageKey}.email-link`));
 }
});
test('OTP consumido com falha temporária ao confirmar usuário não pode ser repetido', async () => {
 const h=run({page:'login',search:'?token_hash=single-use-hash&type=invite',verifyOtpUserError:true,otpAlreadyUsedOnRetry:true}); await h.window.portalReady;
 assert.equal(await h.window.acceptEmailLink(),false);
 assert.equal(h.sessionMap.has(`${h.options().auth.storageKey}.email-link`),true);
 assert.equal(h.sessionMap.has(`${h.options().auth.storageKey}.recovery`),false);
 assert.equal(h.document.getElementById('new-password-form').hidden,true);
 assert.equal(await h.window.acceptEmailLink(),false);
 assert.equal(h.calls.verifyOtp.length,2);
 assert.match(h.document.getElementById('login-message').textContent,/inválido ou expirou/);
});
test('senha salva continua confirmada ao falhar o encerramento local da sessão', async () => {
 const h=run({page:'login',hash:'#type=recovery&access_token=test-token&refresh_token=test-refresh',offlineLogout:true}); await h.window.portalReady;
 assert.equal(await h.window.saveRecoveredPassword('12345678','12345678'),true);
 assert.deepEqual(h.calls.update,[{password:'12345678'}]);
 assert.equal(h.sessionMap.has(h.options().auth.storageKey),false);
 assert.equal(h.document.getElementById('new-password-form').hidden,true);
 assert.match(h.document.getElementById('login-message').textContent,/Senha atualizada/);
});
test('após criar senha no convite, o login ainda exige perfil válido e fazenda liberada', async () => {
 for (const options of [{profileError:true},{farms:[]}]) {
  const h=run({page:'login',search:'?token_hash=invite-hash&type=invite',...options}); await h.window.portalReady;
  assert.equal(await h.window.acceptEmailLink(),true);
  assert.equal(await h.window.saveRecoveredPassword('12345678','12345678'),true);
  assert.equal(await h.window.loginGeoportal(user.email,'123456'),false);
  assert.equal(h.calls.signIn.length,1);
  assert.equal(h.sessionMap.has(h.options().auth.storageKey),false);
  assert.equal(h.redirects.length,0);
 }
});
test('seleção e troca de fazenda só aparecem com mais de uma fazenda liberada', async () => {
 for (const farms of [[{code:'FE',name:'Esperança'}],[{code:'FE',name:'Esperança'},{code:'FS',name:'Outra'}]]) {
  const h=run({initialSession:session,farms}); assert.equal(await h.window.portalReady,true);
  assert.equal(h.document.getElementById('btn-switch-farm').hidden,farms.length<2);
  assert.equal(h.document.getElementById('farm-filter-section').hidden,farms.length<2);
 }
});
test('recuperação e convite aceitam senha numérica de dez caracteres sem exigir letras', async () => {
 for (const type of ['recovery', 'invite']) {
  const h=run({page:'login',hash:'#type='+type+'&access_token=test&refresh_token=test'}); await h.window.portalReady;
  assert.equal(await h.window.saveRecoveredPassword('9876543210','9876543210'),true);
  assert.equal(h.calls.update[0].password,'9876543210');
 }
});
test('recusa do servidor não informa falsamente que a senha longa tem menos de seis caracteres', async () => {
 const h=run({page:'login',hash:'#type=recovery&access_token=test&refresh_token=test',updateError:{code:'weak_password'}}); await h.window.portalReady;
 assert.equal(await h.window.saveRecoveredPassword('9876543210','9876543210'),false);
 assert.doesNotMatch(h.document.getElementById('login-message').textContent,/8 caracteres/);
});
test('OTP temporário de convite ou recuperação abre só a definição de senha, sem autenticar no portal', async () => {
 for (const purpose of ['invite','recovery']) {
  const h=run({page:'login'}); await h.window.portalReady;
  h.window.showTemporaryAccess(purpose,user.email);
  assert.equal(h.document.getElementById('temporary-access-form').hidden,false);
  assert.equal(await h.window.loginTemporaryPassword(user.email,'654321',purpose),true);
  assert.deepEqual(h.calls.verifyOtp,[{email:user.email,token:'654321',type:purpose}]);
  assert.equal(h.calls.signIn.length,0); assert.equal(h.calls.getUser,0);
  assert.equal(h.calls.profile,0);
  assert.equal(h.calls.rpc.some(call=>call.name==='list_accessible_farms_by_gleba'),false);
  assert.deepEqual(h.redirects,[]);
  assert.equal(h.document.getElementById('temporary-password').value,'');
  assert.equal(h.document.getElementById('new-password-form').hidden,false);
  assert.equal(h.sessionMap.get(`${h.options().auth.storageKey}.recovery`),purpose==='invite'?'invite':'1');
 }
});
test('OTP temporário expirado, inválido ou limitado não ativa a definição de senha', async () => {
 for (const verifyOtpError of [Error('expired'),{code:'otp_expired'},{status:429}]) {
  const h=run({page:'login',verifyOtpError}); await h.window.portalReady;
  h.window.showTemporaryAccess('recovery',user.email);
  assert.equal(await h.window.loginTemporaryPassword(user.email,'654321','recovery'),false);
  assert.equal(h.document.getElementById('new-password-form').hidden,true);
  assert.equal(h.document.getElementById('temporary-access-form').hidden,false);
  assert.equal(h.calls.signIn.length,0); assert.equal(h.calls.profile,0);
  assert.deepEqual(h.redirects,[]);
  assert.equal(h.document.getElementById('btn-temporary-login').disabled,false);
 }
});
test('pedido de recuperação oferece OTP temporário sem abrir o portal', async () => {
 const h=run({page:'login'}); await h.window.portalReady;
 assert.equal(await h.window.requestPasswordReset(` ${user.email} `),true);
 assert.equal(h.calls.reset.length,1);
 assert.equal(h.calls.reset[0].email,user.email);
 assert.equal(h.document.getElementById('temporary-access-form').hidden,false);
 assert.equal(h.document.getElementById('temporary-purpose').value,'recovery');
 assert.match(h.document.getElementById('login-message').textContent,/6 dígitos.*1 hora/);
 assert.equal(h.calls.verifyOtp.length,0);
 assert.equal(h.calls.signIn.length,0);
 assert.deepEqual(h.redirects,[]);
});
test('finalidade inválida não envia OTP nem abre definição de senha', async () => {
 const h=run({page:'login'}); await h.window.portalReady;
 h.window.showTemporaryAccess('invite',user.email);
 assert.equal(await h.window.loginTemporaryPassword(user.email,'654321','signup'),false);
 assert.equal(h.calls.verifyOtp.length,0);
 assert.equal(h.document.getElementById('new-password-form').hidden,true);
});
test('OTP que não contém seis dígitos não chega ao serviço de Auth', async () => {
 for (const token of ['12345','1234567','12ab56','']) {
  const h=run({page:'login'}); await h.window.portalReady;
  h.window.showTemporaryAccess('invite',user.email);
  assert.equal(await h.window.loginTemporaryPassword(user.email,token,'invite'),false);
  assert.equal(h.calls.verifyOtp.length,0);
  assert.equal(h.document.getElementById('new-password-form').hidden,true);
 }
});
test('sessão e usuário retornados pelo OTP são usados mesmo se uma chamada separada a getUser falharia', async () => {
 const h=run({page:'login',userError:true}); await h.window.portalReady;
 h.window.showTemporaryAccess('invite',user.email);
 assert.equal(await h.window.loginTemporaryPassword(user.email,'654321','invite'),true);
 assert.equal(h.calls.getUser,0);
 assert.equal(h.calls.verifyOtp.length,1);
 assert.equal(h.document.getElementById('new-password-form').hidden,false);
});
test('OTP temporário de uso único não aceita nova validação após cancelar o primeiro uso', async () => {
 const h=run({page:'login',otpAlreadyUsedOnRetry:true}); await h.window.portalReady;
 h.window.showTemporaryAccess('recovery',user.email);
 assert.equal(await h.window.loginTemporaryPassword(user.email,'654321','recovery'),true);
 await h.window.cancelPasswordRecovery();
 h.window.showTemporaryAccess('recovery',user.email);
 assert.equal(await h.window.loginTemporaryPassword(user.email,'654321','recovery'),false);
 assert.equal(h.calls.verifyOtp.length,2);
 assert.equal(h.document.getElementById('new-password-form').hidden,true);
});
test('OTP temporário não pode ser reutilizado como senha permanente', async () => {
 const h=run({page:'login'}); await h.window.portalReady;
 h.window.showTemporaryAccess('invite',user.email);
 assert.equal(await h.window.loginTemporaryPassword(user.email,'654321','invite'),true);
 assert.equal(await h.window.saveRecoveredPassword('654321','654321'),false);
 assert.equal(h.calls.update.length,0);
 assert.match(h.document.getElementById('login-message').textContent,/8 caracteres/i);
 assert.equal(await h.window.saveRecoveredPassword('98765432','98765432'),true);
 assert.equal(h.calls.update.length,1);
});
test('sessão temporária retoma formulário após F5 e cancelar limpa estado de OTP', async () => {
 const h=run({page:'login'}); await h.window.portalReady;
 h.window.showTemporaryAccess('recovery',user.email);
 assert.equal(await h.window.loginTemporaryPassword(user.email,'654321','recovery'),true);
 const reload=run({page:'login',sessionMap:h.sessionMap}); await reload.window.portalReady;
 assert.equal(reload.document.getElementById('new-password-form').hidden,false);
 assert.equal(reload.sessionMap.get(`${reload.options().auth.storageKey}.recovery`),'1');
 await reload.window.cancelPasswordRecovery();
 assert.equal(reload.document.getElementById('new-password-form').hidden,true);
 assert.equal(reload.sessionMap.has(reload.options().auth.storageKey),false);
 assert.equal(reload.sessionMap.has(`${reload.options().auth.storageKey}.recovery`),false);
});
test('URL pública de primeiro acesso ou recuperação mostra a entrada OTP sem validar email', async () => {
 for (const [search,purpose] of [['?acesso=temporario','invite'],['?acesso=temporario&type=recovery','recovery']]) {
  const h=run({page:'login',search}); await h.window.portalReady;
  assert.equal(h.document.getElementById('temporary-access-form').hidden,false);
  assert.equal(h.document.getElementById('temporary-purpose').value,purpose);
  assert.equal(h.window.location.search,'');
  assert.equal(h.calls.verifyOtp.length,0);
  assert.equal(h.calls.signIn.length,0);
  assert.equal(h.calls.profile,0);
  assert.deepEqual(h.redirects,[]);
 }
});
test('cancelar acesso temporário limpa senha e email inseridos no formulário', async () => {
 const h=run({page:'login',search:'?acesso=temporario'}); await h.window.portalReady;
 h.document.getElementById('temporary-email').value=user.email;
 h.document.getElementById('temporary-password').value='654321';
 await h.window.cancelPasswordRecovery();
 assert.equal(h.document.getElementById('temporary-email').value,'');
 assert.equal(h.document.getElementById('temporary-password').value,'');
 assert.equal(h.document.getElementById('temporary-access-form').hidden,true);
 assert.equal(h.sessionMap.has(`${h.options().auth.storageKey}.recovery`),false);
});
test('conta sem senha permanente não pode abrir o portal', async () => {
 const h=run({initialSession:session,hasPermanentPassword:false});
 assert.equal(await h.window.portalReady,false);
 assert.equal(h.classes.has('portal-loading'),true);
 assert.equal(h.calls.profile,0);
 assert.equal(h.calls.rpc.some(call=>call.name==='list_accessible_farms_by_gleba'),false);
 assert.match(h.redirects[0],/index\.html/);
});
test('login permanente normal verifica a existência de senha permanente antes de entrar', async () => {
 const h=run({page:'login'}); await h.window.portalReady;
 assert.equal(await h.window.loginGeoportal(user.email,'Regular-password!'),true);
 assert.equal(h.calls.rpc.some(call=>call.name==='has_permanent_password'),true);
 assert.deepEqual(h.redirects,['./portal.html']);
});
test('login normal de conta sem senha permanente abre definição de senha e bloqueia o portal', async () => {
 const h=run({page:'login',hasPermanentPassword:false}); await h.window.portalReady;
 assert.equal(await h.window.loginGeoportal(user.email,'Regular-password!'),true);
 assert.equal(h.calls.signIn.length,1);
 assert.equal(h.calls.rpc.some(call=>call.name==='has_permanent_password'),true);
 assert.equal(h.redirects.length,0);
 assert.equal(h.calls.profile,0);
 assert.equal(h.calls.rpc.some(call=>call.name==='list_accessible_farms_by_gleba'),false);
 assert.equal(h.document.getElementById('new-password-form').hidden,false);
});
