export type GameListFilter =
    | "all"
    | "base"
    | "expansion"
    | "owned"
    | "unowned"
    | "wishlist"
    | "preorder"
    | "wantToPlay"
    | "wantToBuy";

export type GameListSort =
    | "name-asc"
    | "name-desc"
    | "year-desc"
    | "year-asc"
    | "rating-desc"
    | "rating-asc"
    | "bgg-rating-desc"
    | "weight-desc";

export interface GameListControllerOptions {
    root: HTMLElement;
    pageSize?: number;
    debounceMs?: number;
}

export function initializeGameListController(options: GameListControllerOptions): void {
    const { root } = options;
    if (root.dataset.initialized === "true") return;

    const grid = root.querySelector("[data-game-grid]") as HTMLElement | null;
    const search = root.querySelector("[data-game-search]") as HTMLInputElement | null;
    const sort = root.querySelector("[data-game-sort]") as HTMLSelectElement | null;
    const pagination = root.querySelector("[data-game-pagination]") as HTMLElement | null;
    const resultCount = root.querySelector("[data-game-result-count]") as HTMLElement | null;
    const resetButton = root.querySelector("[data-game-reset]") as HTMLButtonElement | null;
    const filterButtons = Array.from(root.querySelectorAll("[data-game-filter]")) as HTMLButtonElement[];
    const playerFilter = root.querySelector("[data-game-players]") as HTMLSelectElement | null;
    const timeFilter = root.querySelector("[data-game-time]") as HTMLSelectElement | null;
    const weightFilter = root.querySelector("[data-game-weight]") as HTMLSelectElement | null;
    const mechanicFilter = root.querySelector("[data-game-mechanic]") as HTMLSelectElement | null;
    const tagChips = Array.from(root.querySelectorAll("[data-tag-chip][data-tag-kind][data-tag-id]")) as HTMLButtonElement[];
    if (!grid || !search || !sort || !pagination || !resultCount) return;

    root.dataset.initialized = "true";
    const pageSize = Math.max(1, options.pageSize ?? 24);
    const debounceMs = Math.max(0, options.debounceMs ?? 250);
    const cards = Array.from(grid.querySelectorAll("[data-game-card]")) as HTMLElement[];
    const cardStorage = document.createDocumentFragment();
    cards.forEach(card => cardStorage.appendChild(card));

    const locale = root.dataset.locale === "en" ? "en" : "zh-TW";
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    const labels = locale === "en"
        ? { matching: "Found", games: "games", previous: "Previous", next: "Next", page: "Page", empty: "No matching games" }
        : { matching: "找到", games: "款遊戲", previous: "上一頁", next: "下一頁", page: "頁", empty: "沒有符合條件的遊戲" };
    const defaultSort = sort.value;

    // Build the mechanic menu from the cards actually present on this page.
    if (mechanicFilter) {
        const mechanics = new Map<number, string>();
        for (const card of cards) {
            const ids = (card.dataset.mechanics ?? "").split(",");
            const names = (card.dataset.mechanicNames ?? "").split("|");
            ids.forEach((id, index) => {
                const n = Number(id);
                if (Number.isInteger(n) && n > 0 && names[index]) {
                    mechanics.set(n, names[index]);
                }
            });
        }
        const options = Array.from(mechanics, ([id, name]) => ({ id, name }))
            .sort((a, b) => collator.compare(a.name, b.name));
        for (const mechanic of options) {
            const option = document.createElement("option");
            option.value = String(mechanic.id);
            option.textContent = mechanic.name;
            mechanicFilter.appendChild(option);
        }
    }

    function matchesAdvanced(card: HTMLElement): boolean {
        const players = playerFilter?.value ?? "";
        if (players) {
            const min = numberOrNull(card, "minPlayers");
            const max = numberOrNull(card, "maxPlayers");
            if (min === null || max === null) return false;
            if (players === "6plus") {
                if (max < 6) return false;
            } else {
                const n = Number(players);
                if (n < min || n > max) return false;
            }
        }
        const time = timeFilter?.value ?? "";
        if (time) {
            const maxTime = numberOrNull(card, "maxTime");
            if (maxTime === null || maxTime <= 0) return false;
            if (time === "over120" ? maxTime <= 120 : maxTime > Number(time)) return false;
        }
        const weight = weightFilter?.value ?? "";
        if (weight) {
            const value = numberOrNull(card, "weight");
            if (value === null || value < 1 || value > 5) return false;
            const [min, max] = weight.split("-").map(Number);
            if (value < min || (max === 5 ? value > max : value >= max)) return false;
        }
        const mechanic = mechanicFilter?.value ?? "";
        if (mechanic && !(card.dataset.mechanics ?? "").split(",").includes(mechanic)) return false;
        return true;
    }

    let selectedMechanic = "";
    let selectedCategory = "";
    let activeFilter: GameListFilter = "all";
    let currentPage = 1;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    function matchesTags(card: HTMLElement): boolean {
        if (selectedMechanic && !(card.dataset.mechanics ?? "").split(",").includes(selectedMechanic)) return false;
        if (selectedCategory && !(card.dataset.categories ?? "").split(",").includes(selectedCategory)) return false;
        return true;
    }

    function syncTagChips(): void {
        tagChips.forEach(chip => {
            const selected = chip.dataset.tagKind === "mechanic"
                ? chip.dataset.tagId === selectedMechanic
                : chip.dataset.tagId === selectedCategory;
            chip.setAttribute("aria-pressed", String(selected));
        });
    }

    function matchesFilter(card: HTMLElement): boolean {
        switch (activeFilter) {
            case "base": return card.dataset.expansion === "false";
            case "expansion": return card.dataset.expansion === "true";
            case "owned": return card.dataset.owned === "true";
            case "unowned": return card.dataset.owned !== "true";
            case "wishlist": return card.dataset.wishlist === "true";
            case "preorder": return card.dataset.preorder === "true";
            case "wantToPlay": return card.dataset.wantToPlay === "true";
            case "wantToBuy": return card.dataset.wantToBuy === "true";
            default: return true;
        }
    }

    function numberOrNull(card: HTMLElement, key: string): number | null {
        const raw = card.dataset[key];
        if (raw === undefined || raw.trim() === "") return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function compareNumbers(a: HTMLElement, b: HTMLElement, key: string, descending: boolean): number {
        const x = numberOrNull(a, key);
        const y = numberOrNull(b, key);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return descending ? y - x : x - y;
    }

    function compareCards(a: HTMLElement, b: HTMLElement): number {
        const mode = sort!.value as GameListSort;
        let result = 0;
        switch (mode) {
            case "name-desc": result = collator.compare(b.dataset.name ?? "", a.dataset.name ?? ""); break;
            case "year-desc": result = compareNumbers(a, b, "year", true); break;
            case "year-asc": result = compareNumbers(a, b, "year", false); break;
            case "rating-desc": result = compareNumbers(a, b, "rating", true); break;
            case "rating-asc": result = compareNumbers(a, b, "rating", false); break;
            case "bgg-rating-desc": result = compareNumbers(a, b, "bggRating", true); break;
            case "weight-desc": result = compareNumbers(a, b, "weight", true); break;
            default: result = collator.compare(a.dataset.name ?? "", b.dataset.name ?? "");
        }
        return result || collator.compare(a.dataset.name ?? "", b.dataset.name ?? "") || collator.compare(a.dataset.bggId ?? "", b.dataset.bggId ?? "");
    }

    function pageButton(label: string, page: number, disabled: boolean, active = false): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = disabled;
        button.className = active ? "active" : "";
        if (active) button.setAttribute("aria-current", "page");
        button.addEventListener("click", () => {
            currentPage = page;
            update(false);
        });
        return button;
    }

    function update(resetPage = true): void {
        if (resetPage) currentPage = 1;
        const keyword = search!.value.trim().toLocaleLowerCase();
        const matched = cards.filter(card => {
            if (!matchesFilter(card) || !matchesAdvanced(card) || !matchesTags(card)) return false;
            const haystack = `${card.dataset.name ?? ""} ${card.dataset.originalName ?? ""} ${card.dataset.bggId ?? ""}`.toLocaleLowerCase();
            return haystack.includes(keyword);
        }).sort(compareCards);

        const totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
        currentPage = Math.max(1, Math.min(currentPage, totalPages));
        const start = (currentPage - 1) * pageSize;
        const visible = matched.slice(start, start + pageSize);

        // Move only the currently visible cards into the live DOM.
        Array.from(grid!.children).forEach(card => cardStorage.appendChild(card));
        const fragment = document.createDocumentFragment();
        visible.forEach(card => {
            card.hidden = false;
            card.classList.remove("hidden");
            fragment.appendChild(card);
        });
        grid!.appendChild(fragment);

        resultCount!.textContent = `${labels.matching} ${matched.length} ${labels.games}`;
        if (resetButton) {
            resetButton.disabled = search!.value.trim() === "" && activeFilter === "all" && sort!.value === defaultSort &&
                !playerFilter?.value && !timeFilter?.value && !weightFilter?.value && !mechanicFilter?.value && !selectedMechanic && !selectedCategory;
        }
        pagination!.replaceChildren();
        if (matched.length === 0) {
            const message = document.createElement("p");
            message.textContent = labels.empty;
            pagination!.appendChild(message);
            return;
        }
        if (totalPages === 1) return;
        pagination!.appendChild(pageButton(labels.previous, currentPage - 1, currentPage === 1));
        const first = Math.max(1, currentPage - 2);
        const last = Math.min(totalPages, currentPage + 2);
        for (let page = first; page <= last; page++) {
            pagination!.appendChild(pageButton(String(page), page, false, page === currentPage));
        }
        pagination!.appendChild(pageButton(labels.next, currentPage + 1, currentPage === totalPages));
        const info = document.createElement("span");
        info.textContent = `${labels.page} ${currentPage} / ${totalPages}`;
        pagination!.appendChild(info);
    }

    resetButton?.addEventListener("click", () => {
        if (searchTimer !== undefined) clearTimeout(searchTimer);
        searchTimer = undefined;
        search!.value = "";
        sort!.value = defaultSort;
        if (playerFilter) playerFilter.value = "";
        if (timeFilter) timeFilter.value = "";
        if (weightFilter) weightFilter.value = "";
        if (mechanicFilter) mechanicFilter.value = "";
        activeFilter = "all";
        selectedMechanic = "";
        selectedCategory = "";
        syncTagChips();
        currentPage = 1;
        filterButtons.forEach(item => {
            const active = item.dataset.gameFilter === "all";
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", String(active));
        });
        update();
        search!.focus();
    });

    tagChips.forEach(chip => {
        chip.addEventListener("click", () => {
            const id = chip.dataset.tagId ?? "";
            if (!id) return;
            if (chip.dataset.tagKind === "mechanic") {
                selectedMechanic = selectedMechanic === id ? "" : id;
            } else if (chip.dataset.tagKind === "category") {
                selectedCategory = selectedCategory === id ? "" : id;
            }
            syncTagChips();
            if (searchTimer !== undefined) clearTimeout(searchTimer);
            update();
        });
    });

    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            activeFilter = (button.dataset.gameFilter ?? "all") as GameListFilter;
            filterButtons.forEach(item => {
                const active = item === button;
                item.classList.toggle("active", active);
                item.setAttribute("aria-pressed", String(active));
            });
            if (searchTimer !== undefined) clearTimeout(searchTimer);
            update();
        });
    });
    search.addEventListener("input", () => {
        if (searchTimer !== undefined) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => update(), debounceMs);
    });
    sort.addEventListener("change", () => {
        if (searchTimer !== undefined) clearTimeout(searchTimer);
        update();
    });
    [playerFilter, timeFilter, weightFilter, mechanicFilter].forEach(select => {
        select?.addEventListener("change", () => {
            if (searchTimer !== undefined) clearTimeout(searchTimer);
            update();
        });
    });
    update();
}
