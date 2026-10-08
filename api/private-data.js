module.exports = function handler(_request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.status(404).json({ error: 'Dados disponíveis somente pelo acesso autenticado ao banco.' });
};
