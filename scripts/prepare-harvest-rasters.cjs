const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const source = path.join(root, 'dados/colheita/2026/milho/fe-original/pyramid');
const target = path.join(root, '.publish/harvest-raster-import');
fs.mkdirSync(target, { recursive: true });
const index = JSON.parse(fs.readFileSync(path.join(source, 'index.json'), 'utf8'));
const names = ['index.json', ...index.records.flatMap(record => record.levels.map(level => level.valuesFile))];
for (const [i, name] of names.entries()) {
    if (!/^(index\.json|fe-[\d.]+-[0-5]\.json)$/.test(name)) throw Error('Nome de resolução inválido.');
    const contents = JSON.stringify(JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'))).replaceAll("'", "''");
    const sql = `insert into public.harvest_raster_files(version_id,path,contents) select active_version,'${name}','${contents}'::jsonb from public.harvest_test_datasets where slug='fe-milho-2026' on conflict (version_id,path) do nothing;`;
    fs.writeFileSync(path.join(target, `${String(i).padStart(3, '0')}.sql`), sql);
}
console.log(`${names.length} resoluções preparadas; arquivos originais preservados.`);
