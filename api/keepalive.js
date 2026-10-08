// Chamada diária pela Vercel para manter o projeto Supabase ativo no plano Free.
// A rota executa somente leituras protegidas por RLS; ela nunca altera dados.
const SUPABASE_URL = 'https://qdvlwszyehblmrjnqglx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NW6brFRZlyc9vP0KkzhDPA_rBlALIn3';

module.exports = async (_request, response) => {
    const endpoint = `${SUPABASE_URL}/rest/v1/farms?select=code&limit=1`;
    const requestOptions = {
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
        }
    };

    try {
        const checks = await Promise.all(
            Array.from({ length: 3 }, () => fetch(endpoint, requestOptions))
        );
        const failed = checks.find((check) => !check.ok);
        if (failed) throw new Error(`Supabase respondeu com HTTP ${failed.status}`);

        response.status(200).json({ status: 'ok', checks: checks.length });
    } catch (error) {
        console.error('Falha no keepalive do Supabase:', error);
        response.status(502).json({ status: 'error' });
    }
};
