/* Keep geometry work outside the map's UI thread. No data is persisted here. */
importScripts('fertilizer-routing.js?v=local-access-20261111');
let graph = null, initializationError = null;
self.onmessage = event => {
    const message = event.data;
    if (message.data) {
        try { graph = self.FertilizerRouting.build(message.data); } catch (error) { initializationError = error.message; }
        return;
    }
    try {
        if (initializationError || !graph) throw Error(initializationError || 'Rede de caminhos indisponível.');
        self.postMessage({ id: message.id, result: graph.rank(message.origin, message.mounds) });
    } catch (error) { self.postMessage({ id: message.id, error: error.message }); }
};
