const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/fertilizer-routing-worker.js'), 'utf8');

function workerHarness() {
    const messages = [], calls = [];
    const graph = {
        serviceStripCosts(samples, mounds, progress) {
            calls.push({ operation: 'strips', samples, mounds });
            progress({ stage: 'mounds', done: 1, total: 1 });
            if (samples[0]?.fail) throw new Error('strip route failure');
            return [{ farm_code: 'FE', campo: 'FE01', strip_id: 's1', mound_id: 'm1', score: 10, meters: 9 }];
        },
        serviceBlockCosts(samples, mounds, progress) {
            calls.push({ operation: 'blocks', samples, mounds });
        progress({ stage: 'mounds', done: 1, total: 1 });
            if (samples[0]?.fail) throw new Error('block route failure');
            return [{ farm_code: 'FE', campo: 'Block-A', strip_id: 'ab:1:1', mound_id: 'm1', score: 12, meters: 11 }];
        }
    };
    const self = { postMessage(message) { messages.push(message); } };
    const context = { self, importScripts() {
        self.FertilizerRouting = { build(data) { calls.push({ data }); return graph; } };
    } };
    vm.runInNewContext(source, vm.createContext(context));
    return { self, messages, calls };
}

test('worker dispatches strips to serviceStripCosts and posts progress plus result/error', () => {
    const worker = workerHarness();
    worker.self.onmessage({ data: { data: { year: '2026' } } });
    const samples = [{ farm_code: 'FE', campo: 'FE01', strip_id: 's1', point: [-52, -10], area_ha: 2 }];
    const mounds = [{ id: 'm1', gleba: 'FE' }];
    worker.self.onmessage({ data: { id: 8, operation: 'strips', samples, mounds } });

    assert.equal(worker.calls.length, 2);
    assert.equal(worker.calls[1].operation, 'strips');
    assert.equal(worker.calls[1].samples, samples);
    assert.equal(worker.calls[1].mounds, mounds);
    assert.deepEqual(Array.from(worker.messages, message => message.id), [8, 8]);
    assert.equal(worker.messages[0].progress.stage, 'mounds');
    assert.deepEqual(worker.messages[1].result[0], {
        farm_code: 'FE', campo: 'FE01', strip_id: 's1', mound_id: 'm1', score: 10, meters: 9
    });

    worker.self.onmessage({ data: { id: 9, operation: 'strips', samples: [{ fail: true }], mounds } });
    assert.equal(worker.messages.at(-1).id, 9);
    assert.equal(worker.messages.at(-1).error, 'strip route failure');

    const blockSamples = [{ farm_code: 'FE', campo: 'Block-A', strip_id: 'ab:1:1', point: [-52, -10], area_ha: 2 }];
    worker.self.onmessage({ data: { id: 10, operation: 'blocks', samples: blockSamples, mounds } });
    assert.equal(worker.calls.at(-1).operation, 'blocks');
    assert.equal(worker.calls.at(-1).samples, blockSamples);
    assert.equal(worker.calls.at(-1).mounds, mounds);
    assert.equal(worker.messages.at(-2).id, 10);
    assert.equal(worker.messages.at(-2).progress.stage, 'mounds');
    assert.deepEqual(worker.messages.at(-1).result[0], {
        farm_code: 'FE', campo: 'Block-A', strip_id: 'ab:1:1', mound_id: 'm1', score: 12, meters: 11
    });

    worker.self.onmessage({ data: { id: 11, operation: 'blocks', samples: [{ fail: true }], mounds } });
    assert.equal(worker.messages.at(-1).id, 11);
    assert.equal(worker.messages.at(-1).error, 'block route failure');
});
