(() => {
    document.querySelectorAll('input[type="password"]').forEach(input => {
        const wrapper = document.createElement('span');
        wrapper.className = 'password-field';
        input.before(wrapper); wrapper.append(input);
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'password-visibility';
        button.setAttribute('aria-controls', input.id);
        button.setAttribute('aria-pressed', 'false');
        const label = input.closest('label')?.firstChild?.textContent.trim() || 'senha';
        if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', label);
        button.textContent = 'Mostrar';
        button.setAttribute('aria-label', 'Mostrar ' + label.toLowerCase());
        button.addEventListener('click', () => {
            const visible = input.type === 'password';
            input.type = visible ? 'text' : 'password';
            button.textContent = visible ? 'Ocultar' : 'Mostrar';
            button.setAttribute('aria-pressed', String(visible));
            button.setAttribute('aria-label', (visible ? 'Ocultar ' : 'Mostrar ') + label.toLowerCase());
        });
        wrapper.append(button);
    });
})();
