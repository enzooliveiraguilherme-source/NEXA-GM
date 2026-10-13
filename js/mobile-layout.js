(() => {
    const mobile = matchMedia('(max-width: 820px)');
    const sidebar = document.getElementById('portal-sidebar');
    const main = document.querySelector('.map-area');
    const toggle = document.getElementById('mobile-menu-toggle');
    const close = document.getElementById('mobile-menu-close');
    const backdrop = document.getElementById('mobile-menu-backdrop');
    const filters = document.getElementById('mobile-filter-toggle');
    const filterBar = document.getElementById('calcario-filter-bar');
    const fields = document.getElementById('mobile-field-toggle');
    const harvestSection = document.getElementById('harvest-import-section');
    if (!sidebar || !toggle) return;
    function setMenu(open, restoreFocus = true) {
        const active = mobile.matches && open;
        document.body.classList.toggle('mobile-menu-open', active);
        toggle.setAttribute('aria-expanded', String(active));
        toggle.setAttribute('aria-label', active ? 'Fechar menu' : 'Abrir menu');
        backdrop.hidden = !active;
        sidebar.inert = mobile.matches && !active;
        main.inert = active;
        if (active) close.focus({ preventScroll: true });
        else if (restoreFocus && mobile.matches) toggle.focus({ preventScroll: true });
    }
    toggle.addEventListener('click', () => {
        const scroll = sidebar.querySelector('.sidebar-content-scroll');
        if (scroll) scroll.scrollTop = 0;
        setMenu(true);
    });
    close.addEventListener('click', () => setMenu(false));
    backdrop.addEventListener('click', () => setMenu(false));
    fields?.addEventListener('click', () => {
        setMenu(true);
        const scroll = sidebar.querySelector('.sidebar-content-scroll');
        if (scroll && harvestSection) scroll.scrollTop = harvestSection.offsetTop - scroll.offsetTop;
    });
    document.getElementById('harvest-field-select')?.addEventListener('change', () => {
        if (mobile.matches) setMenu(false);
    });
    document.getElementById('harvest-all')?.addEventListener('click', () => {
        if (mobile.matches) setMenu(false);
    });
    document.getElementById('harvest-back')?.addEventListener('click', () => {
        if (mobile.matches) setMenu(false);
    });
    sidebar.addEventListener('click', event => {
        const item = event.target.closest('.tab-btn, .sub-nav-item');
        if (mobile.matches && item && (!item.closest('.nav-group') || item.matches('.sub-nav-item') || !item.classList.contains('active'))) setMenu(false);
    }, true);
    function closeFilters() {
        document.body.classList.remove('mobile-filters-open');
        filters.setAttribute('aria-expanded', 'false');
    }
    window.addEventListener('geoportal:operation-change', () => {
        closeFilters();
        if (mobile.matches) setMenu(false);
    });
    filters.addEventListener('click', () => {
        const open = document.body.classList.toggle('mobile-filters-open');
        filters.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            if (document.body.classList.contains('mobile-menu-open')) setMenu(false);
            if (document.body.classList.contains('mobile-filters-open')) {
                document.body.classList.remove('mobile-filters-open');
                filters.setAttribute('aria-expanded', 'false');
                filters.focus();
            }
        }
        if (event.key === 'Tab' && document.body.classList.contains('mobile-menu-open')) {
            const items = [...sidebar.querySelectorAll('button, select, input, a[href]')].filter(el => !el.disabled && el.getClientRects().length);
            const first = items[0], last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    function syncFilters() {
        const available = !filterBar.classList.contains('hidden');
        filters.hidden = !available;
        if (!available) closeFilters();
        if (fields) fields.hidden = !mobile.matches || !harvestSection || harvestSection.classList.contains('hidden');
    }
    new MutationObserver(syncFilters).observe(filterBar, { attributes: true, attributeFilter: ['class'] });
    if (harvestSection) new MutationObserver(syncFilters).observe(harvestSection, { attributes: true, attributeFilter: ['class'] });
    syncFilters();
    mobile.addEventListener('change', () => {
        setMenu(false, false);
        document.body.classList.remove('mobile-filters-open');
        filters.setAttribute('aria-expanded', 'false');
        syncFilters();
    });
    setMenu(false, false);
})();
