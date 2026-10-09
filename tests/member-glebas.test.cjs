const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/member-glebas.js');
const directory = [
 {code:'FE2',gleba:'FE'}, {code:'FE',gleba:'FE'}, {code:'IPE',gleba:'FE'},
 {code:'FALG',gleba:'FBLA'}, {code:'FBLA',gleba:'FBLA'}, {code:'FPAR',gleba:'FPAR'}
];
const groups = api.group(directory);
test('FE e suas fazendas aparecem como uma única gleba; outras glebas permanecem separadas', () => {
 assert.deepEqual(groups.map(g=>g.gleba),['FBLA','FE','FPAR']);
 assert.deepEqual(groups.find(g=>g.gleba==='FE').farms,['FE2','FE','IPE']);
});
test('selecionar FE libera todas as fazendas de FE e nenhuma de outras glebas', () => {
 assert.deepEqual(api.expand(groups,[{gleba:'FE',checked:true}]),['FE2','FE','IPE']);
 assert.deepEqual(api.expand(groups,[{gleba:'FE',checked:true},{gleba:'FPAR',checked:true}]),['FE2','FE','IPE','FPAR']);
});
test('acesso parcial existente não se amplia ao alterar apenas o cargo', () => {
 assert.deepEqual(api.expand(groups,[{gleba:'FE',checked:false,indeterminate:true}],['FE2']),['FE2']);
 assert.equal(api.describe(groups,['FE2']),'Gleba FE (acesso parcial)');
 assert.deepEqual(api.expand(groups,[{gleba:'FE',checked:false,indeterminate:false}],['FE2']),[]);
});
test('lista exibe glebas completas sem repetir os códigos das fazendas', () => {
 assert.equal(api.describe(groups,['FE','FE2','IPE']),'Gleba FE');
 assert.equal(api.describe(groups,[]),'Nenhuma');
});
