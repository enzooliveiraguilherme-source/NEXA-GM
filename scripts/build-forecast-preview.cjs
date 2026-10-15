// Preview-only build. Production's build-site.cjs and portal.html stay unchanged.
const fs = require('node:fs');
const path = require('node:path');
require('./build-site.cjs');
const root = process.cwd(), output = path.join(root, 'site-dist');
const html = fs.readFileSync(path.join(root, 'previsao.html'), 'utf8');
fs.writeFileSync(path.join(output, 'portal.html'), html);
fs.writeFileSync(path.join(output, 'previsao-demo.html'), html
    .replace('<script src="auth.js?v=10"></script>', '<script src="js/forecast-demo.js?v=1"></script>')
    .replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', '')
    .replace('<script src="config.js"></script>', '')
    .replace('<script src="js/operations/supabase-repository.js?v=1"></script>', ''));
fs.copyFileSync(path.join(root, 'forecast.css'), path.join(output, 'forecast.css'));
// Keep this deployment focused: old application entrypoints cannot write to production.
for (const file of ['admin.html', 'projetista.html', 'visualizador.html']) {
    fs.writeFileSync(path.join(output, file), '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./portal.html"><title>NEXA · Teste</title><a href="./portal.html">Abrir laboratório da safra</a></html>');
}
const loginPath = path.join(output, 'index.html');
const login = fs.readFileSync(loginPath, 'utf8').replace('</body>', '<a href="./previsao-demo.html" style="position:fixed;bottom:18px;left:0;width:100%;text-align:center;color:#46614e;font:13px sans-serif">Versão de teste · abrir demonstração com dados fictícios</a></body>');
fs.writeFileSync(loginPath, login);
console.log('Laboratório pronto: login real somente para consulta; simulações em memória; demonstração fictícia em /previsao-demo.');
