const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const output = path.resolve(root, 'site-dist');
if (output !== path.join(root, 'site-dist') || !output.startsWith(root + path.sep)) throw Error('Destino de publicação inválido.');
// Somente a saída gerada deste projeto é limpa; fontes e dados originais permanecem.
fs.rmSync(output, {recursive:true,force:true});
fs.mkdirSync(output);
for (const file of ['index.html','portal.html','admin.html','projetista.html','visualizador.html','app.js','auth.js','config.js','style.css','brand.css']) {
    fs.copyFileSync(path.join(root,file),path.join(output,file));
}
fs.mkdirSync(path.join(output,'apoio'));
fs.copyFileSync(path.join(root,'apoio','GP Michels.jpg'),path.join(output,'apoio','GP Michels.jpg'));
fs.cpSync(path.join(root,'js'),path.join(output,'js'),{recursive:true,filter:source=>fs.statSync(source).isDirectory() || source.endsWith('.js')});
console.log('Site preparado: fontes de dados e arquivos de desenvolvimento excluídos da publicação.');
