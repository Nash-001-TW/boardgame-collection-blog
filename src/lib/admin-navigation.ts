document.querySelectorAll<HTMLAnchorElement>('[data-language-switch]').forEach(link => {
    const target = new URL(location.href);
    target.searchParams.set('lang', link.lang);
    link.href = target.href;
    link.addEventListener('click', () => {
        const current = new URL(location.href);
        current.searchParams.set('lang', link.lang);
        link.href = current.href;
    });
});
