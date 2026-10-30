const test = require('node:test');
const assert = require('node:assert/strict');
const Rate = require('../js/savefarm-rate.js');

test('interpolação e limite da taxa retornam cores corretas', () => {
    const scale = { kind: 'continuous', min: 0, max: 100, stops: [
        { value: 0, color: '#ff0000' }, { value: 100, color: '#0000ff' }
    ] };
    assert.equal(Rate.colorFor(0, scale), '#ff0000');
    assert.equal(Rate.colorFor(25, scale), '#bf0040');
    assert.equal(Rate.colorFor(100, scale), '#0000ff');
    assert.equal(Rate.colorFor(150, scale), '#0000ff');
    assert.equal(Rate.colorFor(-1, scale), Rate.missingColor);
});

test('escala sólida usa faixas discretas e gradiente constante usa uma cor', () => {
    const solid = { kind: 'solid', stops: [
        { value: 0, color: '#ff0000' }, { value: 10, color: '#00ff00' }, { value: 20, color: '#0000ff' }
    ] };
    assert.equal(Rate.colorFor(9, solid), '#ff0000');
    assert.equal(Rate.colorFor(10, solid), '#00ff00');
    assert.equal(Rate.colorFor(25, solid), '#0000ff');
    assert.equal(Rate.gradient(solid), 'linear-gradient(to right,#ff0000 0%,#ff0000 50%,#00ff00 50%,#00ff00 100%,#0000ff 100%)');

    const constant = { kind: 'constant', min: 0, max: 0, stops: [{ value: 0, color: '#147a42' }] };
    assert.equal(Rate.colorFor(0, constant), '#147a42');
    assert.equal(Rate.gradient(constant), '#147a42');
});

test('taxa nula ou inválida usa cor sem valor e escalas inválidas não geram CSS arbitrário', () => {
    const scale = { kind: 'continuous', stops: [
        { value: 0, color: '#112233' }, { value: 10, color: '#aabbcc' }
    ] };
    assert.equal(Rate.colorFor(null, scale), Rate.missingColor);
    assert.equal(Rate.colorFor(Number.NaN, scale), Rate.missingColor);
    assert.equal(Rate.colorFor(0, scale), '#112233');

    const unsafe = { kind: 'continuous', stops: [
        { value: 0, color: 'url(javascript:alert(1))' }, { value: 10, color: '#aabbcc' }
    ] };
    const background = Rate.gradient(unsafe);
    assert.equal(background, '#aabbcc');
    assert.doesNotMatch(background, /[;{}]|url\s*\(|var\s*\(/i);
    assert.equal(Rate.colorFor(10, unsafe), '#aabbcc');
    assert.equal(Rate.gradient({ kind: 'unavailable', stops: [] }), Rate.missingColor);
});
