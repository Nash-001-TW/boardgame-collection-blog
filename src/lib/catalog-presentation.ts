/** Progressive images with stable native grid layout and sorted DOM/tab order. */
export function createCatalogPresentation(_root: HTMLElement, grid: HTMLElement) {
    let frame = 0;
    let destroyed = false;
    let onLayout = () => {};
    const layout = () => {
        if (destroyed) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            // Native grid reserves cover space before hydration and image decode.
            // Avoid masonry read/write loops over every visible card.
            onLayout();
        });
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
    resize?.observe(grid);
    const hydrated = new WeakSet<HTMLElement>();
    let initialImages = 0;
    const hydrate = (cards: HTMLElement[]) => {
        for (const card of cards) {
            if (hydrated.has(card)) continue;
            resize?.observe(card);
            const shell = card.querySelector<HTMLElement>("[data-image-container]");
            if (!shell || !card.dataset.imageSrc) { hydrated.add(card); continue; }
            const image = shell.querySelector<HTMLImageElement>("img") ?? document.createElement("img");
            image.alt = card.dataset.imageAlt ?? "";
            // Start a small first-screen set immediately; remaining batches stay lazy.
            const priority = initialImages++ < 4;
            image.loading = priority ? "eager" : "lazy";
            image.fetchPriority = priority ? "high" : "auto";
            image.decoding = "async";
            const loaded = () => {
                shell.dataset.imageLoaded = "true";
                // Record real intrinsic size only, never invented BGG dimensions.
                image.width = image.naturalWidth;
                image.height = image.naturalHeight;
                layout();
            };
            image.addEventListener("load", loaded, { once:true });
            let fallbackAttempted = false;
            const failed = () => {
                if (!fallbackAttempted && card.dataset.imageFallback) {
                    fallbackAttempted = true;
                    image.src = card.dataset.imageFallback;
                    return;
                }
                image.remove();
                delete shell.dataset.imagePresent;
                const placeholder = shell.querySelector<HTMLElement>("[data-image-placeholder]");
                if (placeholder) placeholder.textContent = card.dataset.imageErrorLabel ?? "Image unavailable";
                layout();
            };
            image.addEventListener("error", failed);
            shell.appendChild(image);
            shell.dataset.imagePresent = "true";
            if (image.getAttribute("src") !== card.dataset.imageSrc) image.src = card.dataset.imageSrc;
            if (image.complete) {
                if (image.naturalWidth > 0) loaded();
                else failed(); // An SSR image may have failed before the controller attached.
            }
            hydrated.add(card);
        }
    };
    return { hydrate, layout, release(card:HTMLElement) { resize?.unobserve(card); }, onLayout(callback: () => void) { onLayout = callback; },
        destroy() { destroyed = true; resize?.disconnect(); cancelAnimationFrame(frame); } };
}
