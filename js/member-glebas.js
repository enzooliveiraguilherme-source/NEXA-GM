(function (root) {
    'use strict';
    const api = {
        group(farms) {
            const groups = new Map();
            for (const farm of farms) {
                const gleba = farm.gleba || farm.code;
                if (!groups.has(gleba)) groups.set(gleba, { gleba, farms: [] });
                groups.get(gleba).farms.push(farm.code);
            }
            return Array.from(groups.values()).sort((a, b) => a.gleba.localeCompare(b.gleba, 'pt-BR'));
        },
        expand(groups, choices, previous = []) {
            return Array.from(new Set(groups.flatMap(group => {
                const choice = choices.find(item => item.gleba === group.gleba);
                if (choice?.checked) return group.farms;
                if (choice?.indeterminate) return group.farms.filter(code => previous.includes(code));
                return [];
            })));
        },
        describe(groups, farms) {
            return groups.flatMap(group => {
                const count = group.farms.filter(code => farms.includes(code)).length;
                return count ? ['Gleba ' + group.gleba + (count < group.farms.length ? ' (acesso parcial)' : '')] : [];
            }).join(', ') || 'Nenhuma';
        }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MemberGlebas = api;
})(typeof window !== 'undefined' ? window : globalThis);
