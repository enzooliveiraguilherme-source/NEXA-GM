(function (root) {
    'use strict';
    const missingColor = '#94a3b8';
    const number = value => typeof value === 'number' && Number.isFinite(value);
    function stops(scale) {
        return (scale?.stops || []).filter(stop => number(stop?.value) && /^#[a-f0-9]{6}$/i.test(stop?.color || ''));
    }
    function colorFor(value, scale) {
        const list = stops(scale);
        if (!number(value) || value < 0 || !list.length || scale.kind === 'unavailable') return missingColor;
        if (list.length === 1 || value <= list[0].value) return list[0].color;
        if (value >= list[list.length - 1].value) return list[list.length - 1].color;
        for (let i = 1; i < list.length; i++) {
            if (value < list[i].value || (scale.kind !== 'solid' && value === list[i].value)) {
                const a = list[i - 1], b = list[i];
                if (scale.kind === 'solid') return a.color;
                const t = (value - a.value) / (b.value - a.value);
                const channel = shift => Math.round(((parseInt(a.color.slice(1), 16) >> shift) & 255) * (1 - t) +
                    ((parseInt(b.color.slice(1), 16) >> shift) & 255) * t).toString(16).padStart(2, '0');
                return '#' + channel(16) + channel(8) + channel(0);
            }
        }
        return list[list.length - 1].color;
    }
    function gradient(scale) {
        const list = stops(scale), min = list[0]?.value, max = list[list.length - 1]?.value;
        if (!list.length) return missingColor;
        if (list.length === 1 || min === max) return list[0].color;
        const parts = [];
        list.forEach((stop, i) => {
            const position = (stop.value - min) / (max - min) * 100;
            parts.push(stop.color + ' ' + position + '%');
            if (scale.kind === 'solid' && i < list.length - 1) parts.push(stop.color + ' ' + (list[i + 1].value - min) / (max - min) * 100 + '%');
        });
        return 'linear-gradient(to right,' + parts.join(',') + ')';
    }
    const api = Object.freeze({ colorFor, gradient, missingColor });
    root.SaveFarmRate = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
