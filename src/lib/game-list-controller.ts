import { createCatalogStore } from "./catalog-store";
import { selectCatalogEntries } from './catalog-selection';
import type { BrowserEntry } from "./catalog-store";

import { readBrowserUrl, writeBrowserUrl, getEffectiveBrowserFilter } from "./game-browser-url";
import type { BrowserUrlState } from "./game-browser-url";
import { browserCapabilities } from "./game-browser-capabilities";
import { matchesPlayingTime, matchesCatalogSearch, validCatalogStatistic } from "./catalog-browsing";
import { createCatalogPresentation } from "./catalog-presentation";
import { formatAdvancedFilterCount } from "../i18n/catalog-browser";
import { validGameComplexity } from "./game-complexity";

export type GameListFilter =
    | "all"
    | "base"
    | "expansion"
    | "accessory"
    | "unknown"
    | "bundle"
    | "promo"
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

export function initializeGameListController(
    options: GameListControllerOptions
): void {
    const { root } = options;

    if (root.dataset.initialized === "true") return;

    const grid = root.querySelector(
        "[data-game-grid]"
    ) as HTMLElement | null;

    const search = root.querySelector(
        "[data-game-search]"
    ) as HTMLInputElement | null;

    const sort = root.querySelector(
        "[data-game-sort]"
    ) as HTMLSelectElement | null;

    const pagination = root.querySelector(
        "[data-game-pagination]"
    ) as HTMLElement | null;

    const resultCount = root.querySelector(
        "[data-game-result-count]"
    ) as HTMLElement | null;

    const resetButton = root.querySelector(
        "[data-game-reset]"
    ) as HTMLButtonElement | null;

    const filterButtons = Array.from(
        root.querySelectorAll("[data-game-filter]")
    ) as HTMLButtonElement[];

    const playerFilter = root.querySelector(
        "[data-game-players]"
    ) as HTMLSelectElement | null;

    const timeFilter = root.querySelector(
        "[data-game-time]"
    ) as HTMLSelectElement | null;

    const weightFilter = root.querySelector(
        "[data-game-weight]"
    ) as HTMLSelectElement | null;

    const accessoryFilter = root.querySelector("[data-game-accessory]") as unknown as HTMLSelectElement | null;
    const mechanicFilter = root.querySelector(
        "[data-game-mechanic]"
    ) as HTMLSelectElement | null;

    const tagChips = Array.from(
        root.querySelectorAll(
            "[data-tag-chip][data-tag-kind][data-tag-id]"
        )
    ) as HTMLButtonElement[];

    if (
        !grid ||
        !search ||
        !sort ||
        !pagination ||
        !resultCount
    ) {
        return;
    }

    root.dataset.initialized = "true";
    const progressive = root.dataset.loadingMode === "progressive";
    const presentation = progressive ? createCatalogPresentation(root, grid) : null;
    const loadButton = root.querySelector<HTMLButtonElement>("[data-load-more]");
    const loadStatus = root.querySelector<HTMLElement>("[data-load-status]");
    const sentinel = root.querySelector<HTMLElement>("[data-load-sentinel]");
    const backTop = root.querySelector<HTMLButtonElement>("[data-back-to-top]");
    let matchingCount = 0, loading = false, generation = 0, autoLoadBlocked = false;

    const pageSize = Math.max(
        1,
        options.pageSize ?? 24
    );

    const debounceMs = Math.max(
        0,
        options.debounceMs ?? 250
    );

    const store = progressive ? createCatalogStore(root, grid) : null;
    const cards: BrowserEntry[] = store?.entries ?? Array.from(
        grid.querySelectorAll("[data-game-card]")
    ) as HTMLElement[];

    const cardStorage = document.createDocumentFragment();

    if (!store) cards.forEach(card => { cardStorage.appendChild(card as HTMLElement); });

    const locale =
        root.dataset.locale === "en" ? "en" : "zh-TW";

    const collator = new Intl.Collator(locale, {
        numeric: true,
        sensitivity: "base"
    });

    const labels = locale === "en"
        ? {
            matching: "Found",
            games: "games",
            previous: "Previous",
            next: "Next",
            page: "Page",
            empty: "No matching games"
        }
        : {
            matching: "找到",
            games: "款遊戲",
            previous: "上一頁",
            next: "下一頁",
            page: "頁",
            empty: "沒有符合條件的遊戲"
        };

    const defaultSort = sort.value;
    const capabilities = browserCapabilities[root.dataset.browserModule === "collection" ? "collection" : "games"];
    const extraTypeElement = root.querySelector("[data-game-type-advanced]");
    const extraType = extraTypeElement instanceof HTMLSelectElement ? extraTypeElement : null;
    const viewButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-game-view]"));
    const scopeNotice = root.querySelector<HTMLElement>("[data-game-effective-type]");

    // ============================================================
    // 建立核心機制下拉選單
    // ============================================================

    if (mechanicFilter) {
        const mechanics = new Map<string, string>(Object.entries(store?.mechanics ?? {}));

        for (const card of cards) {
            const ids = (
                card.dataset.mechanics ?? ""
            ).split(",");

            const names = (
                card.dataset.mechanicNames ?? ""
            ).split("|");

            ids.forEach((id, index) => {
                const n = Number(id);

                if (
                    Number.isInteger(n) &&
                    n > 0 &&
                    names[index]
                ) {
                    mechanics.set(String(n), names[index]);
                }
            });
        }

        const mechanicOptions = Array.from(
            mechanics,
            ([id, name]) => ({ id, name })
        ).sort((a, b) => {
            return collator.compare(a.name, b.name);
        });

        for (const mechanic of mechanicOptions) {
            const option = document.createElement("option");

            option.value = String(mechanic.id);
            option.textContent = mechanic.name;

            mechanicFilter.appendChild(option);
        }
    }

    // ============================================================
    // 狀態
    // ============================================================

    let selectedMechanic = "";
    let selectedCategory = "";

    let activeFilter = capabilities.defaultFilter as GameListFilter;
    let filterExplicit = false;
    let viewMode: "grid" | "list" = "grid";
    let currentPage = 1;

    let searchTimer:
        ReturnType<typeof setTimeout> | undefined;

    search.maxLength = 200;
    const values = (select: HTMLSelectElement | null) =>
        Array.from(select?.options ?? []).map(option => option.value);
    const choices = {
        parameters: capabilities.parameters,
        defaultSort,
        defaultFilter: capabilities.defaultFilter,
        views: capabilities.views,
        filters: [...filterButtons.map(button => button.dataset.gameFilter ?? "all"), ...values(extraType)]
            .filter(value => capabilities.filters.includes(value)),
        sorts: values(sort).filter(value => capabilities.sorts.includes(value)), players: values(playerFilter), times: values(timeFilter),
        accessories: values(accessoryFilter), weights: values(weightFilter), mechanics: values(mechanicFilter),
        mechanicTags: tagChips.filter(chip => chip.dataset.tagKind === "mechanic")
            .map(chip => chip.dataset.tagId ?? ""),
        categories: tagChips.filter(chip => chip.dataset.tagKind === "category")
            .map(chip => chip.dataset.tagId ?? "")
    };
    const urlNotice = document.createElement("p");
    urlNotice.setAttribute("role", "status");
    urlNotice.hidden = true;
    resultCount.parentNode?.insertBefore(urlNotice, resultCount.nextSibling);
    let urlAvailable = true;

    function currentState(): BrowserUrlState {
        return {
            q: search!.value.trim().slice(0, 200), filter: activeFilter,
            filterExplicit, view: viewMode,
            sort: sort!.value, players: playerFilter?.value ?? "",
            time: timeFilter?.value ?? "", weight: weightFilter?.value ?? "",
            mechanic: mechanicFilter?.value ?? "", tagMechanic: selectedMechanic,
            accessory: accessoryFilter?.value ?? "", category: selectedCategory, page: currentPage
        };
    }

    function saveUrl(mode: "push" | "replace") {
        if (!urlAvailable) return;
        try {
            const next = writeBrowserUrl(new URL(window.location.href), currentState(), defaultSort, choices.parameters, choices.defaultFilter);
            if (next.href !== window.location.href) {
                // Preserve state owned by Astro or other navigation code.
                window.history[mode === "push" ? "pushState" : "replaceState"](
                    window.history.state, "", next.href
                );
                document.dispatchEvent(new Event("catalog:urlchange"));
            }
        } catch {
            urlAvailable = false;
            urlNotice.textContent = locale === "en"
                ? "Your browser could not save these filters in the URL. Browsing still works."
                : "瀏覽器無法將條件保存至網址；搜尋與篩選仍可使用。";
            urlNotice.hidden = false;
        }
    }

    function restoreUrl() {
        generation++;
        loading = false;
        autoLoadBlocked = false;
        grid!.removeAttribute("aria-busy");
        if (searchTimer !== undefined) clearTimeout(searchTimer);
        searchTimer = undefined;
        const state = readBrowserUrl(new URL(window.location.href), choices);
        search!.value = state.q;
        sort!.value = state.sort;
        activeFilter = state.filter as GameListFilter;
        filterExplicit = state.filterExplicit;
        viewMode = state.view;
        if (playerFilter) playerFilter.value = state.players;
        if (timeFilter) timeFilter.value = state.time;
        if (weightFilter) weightFilter.value = state.weight;
        if (mechanicFilter) mechanicFilter.value = state.mechanic;
        if (accessoryFilter) accessoryFilter.value = state.accessory??"";
        if (accessoryFilter?.value) { activeFilter="accessory"; filterExplicit=true; }
        selectedMechanic = state.tagMechanic;
        selectedCategory = state.category;
        currentPage = state.page;
        filterButtons.forEach(button => {
            const active = button.dataset.gameFilter === activeFilter;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        syncTagChips();
        update(false, "replace");
        restoreScroll();
    }

    // ============================================================
    // 資料讀取工具
    // ============================================================

    function numberOrNull(
        card: BrowserEntry,
        key: string
    ): number | null {
        const raw = card.dataset[key];

        if (
            raw === undefined ||
            raw.trim() === ""
        ) {
            return null;
        }

        const value = Number(raw);

        // Catalog filter/sort share the detail validity rule; personal collection behavior stays unchanged.
        if (key === "weight" && root.dataset.browserModule === "games") return validGameComplexity(value);
        if (root.dataset.browserModule === "games" && (key === "year" || key === "bggRating"))
            return validCatalogStatistic(value, key === "year" ? "year" : "rating");

        return Number.isFinite(value)
            ? value
            : null;
    }

    // ============================================================
    // 進階篩選
    // ============================================================

    function matchesAdvanced(
        card: BrowserEntry
    ): boolean {
        // 玩家人數
        const players = playerFilter?.value ?? "";

        if (players) {
            const min = numberOrNull(card, "minPlayers");
            const max = numberOrNull(card, "maxPlayers");

            if (
                min === null ||
                max === null
            ) {
                return false;
            }

            if (players === "6plus") {
                if (max < 6) return false;
            } else {
                const n = Number(players);

                if (
                    n < min ||
                    n > max
                ) {
                    return false;
                }
            }
        }

        // 遊戲時間
        const time = timeFilter?.value ?? "";

        if (time) {
            const maxTime = numberOrNull(
                card,
                "maxTime"
            );

            if (
                maxTime === null ||
                maxTime <= 0
            ) {
                return false;
            }

            if (!matchesPlayingTime(maxTime, time)) {
                return false;
            }
        }

        // 複雜度
        const weight = weightFilter?.value ?? "";

        if (weight) {
            const value = numberOrNull(
                card,
                "weight"
            );

            if (
                value === null ||
                value < 1 ||
                value > 5
            ) {
                return false;
            }

            const [min, max] = weight
                .split("-")
                .map(Number);

            if (
                value < min ||
                (
                    max === 5
                        ? value > max
                        : value >= max
                )
            ) {
                return false;
            }
        }

        if (accessoryFilter?.value && !(card.dataset.accessoryCategories??"").split(",").includes(accessoryFilter.value)) return false;

        // 核心機制
        const mechanic = mechanicFilter?.value ?? "";

        if (
            mechanic &&
            !(card.dataset.mechanics ?? "")
                .split(",")
                .includes(mechanic)
        ) {
            return false;
        }

        return true;
    }

    // ============================================================
    // 標籤篩選
    // ============================================================

    function matchesTags(
        card: BrowserEntry
    ): boolean {
        if (
            selectedMechanic &&
            !(card.dataset.mechanics ?? "")
                .split(",")
                .includes(selectedMechanic)
        ) {
            return false;
        }

        if (
            selectedCategory &&
            !(card.dataset.categories ?? "")
                .split(",")
                .includes(selectedCategory)
        ) {
            return false;
        }

        return true;
    }

    function syncTagChips(): void {
        tagChips.forEach(chip => {
            const selected =
                chip.dataset.tagKind === "mechanic"
                    ? chip.dataset.tagId === selectedMechanic
                    : chip.dataset.tagId === selectedCategory;

            chip.setAttribute(
                "aria-pressed",
                String(selected)
            );
        });
    }

    // ============================================================
    // 收藏類型與狀態篩選
    // ============================================================

    function matchesFilter(
        card: BrowserEntry
    ): boolean {
        // D1 V2 使用 data-item-type
        // 舊版遊戲卡片使用 data-expansion
        const itemType = card.dataset.itemType;

        switch (getEffectiveBrowserFilter(currentState(), capabilities.searchAllTypesByDefault)) {
            case "base":
                return itemType !== undefined
                    ? itemType === "base"
                    : card.dataset.expansion === "false";

            case "expansion":
                return itemType !== undefined
                    ? itemType === "expansion"
                    : card.dataset.expansion === "true";

            case "bundle":
                return itemType === "bundle";

            case "accessory":
                return itemType === "accessory";

            case "unknown":
                return itemType === "unknown";

            case "promo":
                return itemType === "promo";

            case "owned":
                return card.dataset.owned === "true";

            case "unowned":
                return card.dataset.owned === "false";

            case "wishlist":
                return card.dataset.wishlist === "true";

            case "preorder":
                return card.dataset.preorder === "true";

            case "wantToPlay":
                return card.dataset.wantToPlay === "true";

            case "wantToBuy":
                return card.dataset.wantToBuy === "true";

            default:
                return true;
        }
    }

    // ============================================================
    // 排序
    // ============================================================

    function compareNumbers(
        a: BrowserEntry,
        b: BrowserEntry,
        key: string,
        descending: boolean
    ): number {
        const x = numberOrNull(a, key);
        const y = numberOrNull(b, key);

        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;

        return descending
            ? y - x
            : x - y;
    }

    function compareCards(
        a: BrowserEntry,
        b: BrowserEntry
    ): number {
        const mode = sort!.value as GameListSort;

        let result = 0;

        switch (mode) {
            case "name-desc":
                result = collator.compare(
                    b.dataset.name ?? "",
                    a.dataset.name ?? ""
                );
                break;

            case "year-desc":
                result = compareNumbers(
                    a, b, "year", true
                );
                break;

            case "year-asc":
                result = compareNumbers(
                    a, b, "year", false
                );
                break;

            case "rating-desc":
                result = compareNumbers(
                    a, b, "rating", true
                );
                break;

            case "rating-asc":
                result = compareNumbers(
                    a, b, "rating", false
                );
                break;

            case "bgg-rating-desc":
                result = compareNumbers(
                    a, b, "bggRating", true
                );
                break;

            case "weight-desc":
                result = compareNumbers(
                    a, b, "weight", true
                );
                break;

            default:
                result = collator.compare(
                    a.dataset.name ?? "",
                    b.dataset.name ?? ""
                );
                break;
        }

        if (result !== 0) return result;

        // 名稱作為次要排序條件
        result = collator.compare(
            a.dataset.name ?? "",
            b.dataset.name ?? ""
        );

        if (result !== 0) return result;

        // BGG ID 作為第三排序條件
        result = collator.compare(
            a.dataset.catalogKey ?? a.dataset.bggId ?? "",
            b.dataset.catalogKey ?? b.dataset.bggId ?? ""
        );

        if (result !== 0) return result;

        // D1 收藏 ID 作為最後排序條件
        return compareNumbers(
            a,
            b,
            "collectionId",
            false
        );
    }

    // ============================================================
    // 分頁按鈕
    // ============================================================

    function pageButton(
        label: string,
        page: number,
        disabled: boolean,
        active = false
    ): HTMLButtonElement {
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = label;
        button.disabled = disabled;

        button.className = active ? "active" : "";

        if (active) {
            button.setAttribute(
                "aria-current",
                "page"
            );
        }

        button.addEventListener("click", () => {
            currentPage = page;
            update(false);
        });

        return button;
    }

    // ============================================================
    // 更新搜尋、篩選、排序及分頁
    // ============================================================

    function update(
        resetPage = true,
        historyMode: "push" | "replace" = "push"
    ): void {
        if (resetPage) {
            currentPage = 1;
            generation++;
            loading = false;
            autoLoadBlocked = false;
            grid!.removeAttribute("aria-busy");
        }

        const keyword = search!.value
            .trim()
            .toLocaleLowerCase();

        const effectiveFilter = getEffectiveBrowserFilter(currentState(), capabilities.searchAllTypesByDefault);
        filterButtons.forEach(button => {
            const active = button.dataset.gameFilter === effectiveFilter;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        if (extraType) extraType.value = effectiveFilter === "unknown" ? "unknown" : "";
        root.dataset.view = viewMode;
        viewButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.gameView === viewMode)));
        if (scopeNotice) {
            const names: Record<string, string> = locale === "en"
                ? { all: "All types", base: "Base games", expansion: "Expansions", accessory: "Accessories", unknown: "Unknown type" }
                : { all: "全部類型", base: "基本遊戲", expansion: "擴充", accessory: "配件", unknown: "未知類型" };
            const automatic = capabilities.searchAllTypesByDefault && !filterExplicit && keyword;
            scopeNotice.textContent = (locale === "en" ? "Type: " : "生效類型：") + (names[effectiveFilter] ?? effectiveFilter) +
                (automatic ? (locale === "en" ? " (automatic search scope; clearing returns to base games)" : "（搜尋自動涵蓋；清除後回到基本遊戲）") : "");
        }

        const matched = store && root.dataset.browserModule==='games' ? selectCatalogEntries(cards,currentState(),locale) : cards
            .filter(card => {
                if (
                    !matchesFilter(card) ||
                    !matchesAdvanced(card) ||
                    !matchesTags(card)
                ) {
                    return false;
                }

                if (root.dataset.browserModule === "games") return matchesCatalogSearch(card.dataset, keyword);
                const haystack = [
                    card.dataset.name ?? "",
                    card.dataset.originalName ?? "",
                    card.dataset.resolvedName ?? "",
                    card.dataset.notBggId ?? "",
                    card.dataset.bggId ?? "",
                    card.dataset.collectionId ?? ""
                ]
                    .join(" ")
                    .toLocaleLowerCase();

                return haystack.includes(keyword);
            })
            .sort(compareCards);
        matchingCount = matched.length;

        const totalPages = Math.max(
            1,
            Math.ceil(matched.length / pageSize)
        );

        currentPage = Math.max(
            1,
            Math.min(currentPage, totalPages)
        );

        // Store the clamped page, including empty-result pages, not untrusted input.
        saveUrl(historyMode);

        const start = progressive ? 0 : (
            currentPage - 1
        ) * pageSize;

        const visibleEntries = matched.slice(start, progressive ? currentPage * pageSize : start + pageSize);
        const visible = store ? store.prepare(visibleEntries) : visibleEntries as HTMLElement[];
        try {
            presentation?.hydrate(visible);
        } catch (error) {
            // A failed new batch must not retain unmounted cards through ResizeObserver.
            if (store) {
                visible.filter(card => card.parentElement !== grid).forEach(card => presentation?.release(card));
                store.commit(Array.from(grid!.children) as HTMLElement[]);
            }
            throw error;
        }

        // 先將目前顯示的卡片移回暫存區
        Array.from(grid!.children).forEach(card => {
            if (store) {
                if (!visible.includes(card as HTMLElement)) {
                    presentation?.release(card as HTMLElement);
                    card.remove();
                }
            }
            else cardStorage.appendChild(card);
        });

        // 只把當前頁面的卡片放回 DOM
        const fragment = document.createDocumentFragment();

        let cursor = grid!.firstElementChild;
        visible.forEach(card => {
            card.hidden = false;
            card.classList.remove("hidden");
            if (store) {
                // Retain existing image elements and focus while appending the next batch.
                if (card === cursor) cursor = cursor.nextElementSibling;
                else grid!.insertBefore(card, cursor);
            } else fragment.appendChild(card);
        });

        grid!.appendChild(fragment);
        store?.commit(visible);
        presentation?.layout();

        // 更新符合條件的數量
        resultCount!.textContent =
            `${labels.matching} ${matched.length} ${labels.games}`;
        const summary = root.querySelector<HTMLElement>("[data-game-advanced-summary]");
        const clearAdvanced = root.querySelector<HTMLButtonElement>("[data-game-clear-advanced]");
        const selected = [playerFilter, timeFilter, weightFilter, mechanicFilter, accessoryFilter]
            .filter(select => select?.value).map(select => select!.selectedOptions[0]?.textContent ?? "");
        if (summary) {
            summary.textContent = formatAdvancedFilterCount(selected.length, locale);
            summary.hidden = selected.length === 0;
        }
        if (clearAdvanced) clearAdvanced.hidden = selected.length === 0;

        // 更新重設按鈕狀態
        if (resetButton) {
            resetButton.disabled =
                search!.value.trim() === "" &&
                activeFilter === capabilities.defaultFilter && !filterExplicit &&
                sort!.value === defaultSort &&
                !playerFilter?.value &&
                !timeFilter?.value &&
                !weightFilter?.value &&
                !mechanicFilter?.value && !accessoryFilter?.value &&
                !selectedMechanic &&
                !selectedCategory;
        }

        // 重建分頁按鈕
        pagination!.replaceChildren();

        if (progressive) {
            if (loadButton) loadButton.disabled = loading || visible.length >= matched.length;
            if (loadStatus) loadStatus.textContent = matched.length === 0 ? labels.empty :
                (locale === "en" ? `Showing ${visible.length} / ${matched.length}` : `已顯示 ${visible.length} / ${matched.length}`) +
                (visible.length >= matched.length ? (locale === "en" ? " · All loaded" : " · 已全部載入") : "");
            return;
        }

        if (matched.length === 0) {
            const message = document.createElement("p");

            message.textContent = labels.empty;

            pagination!.appendChild(message);
            return;
        }

        if (totalPages === 1) return;

        pagination!.appendChild(
            pageButton(
                labels.previous,
                currentPage - 1,
                currentPage === 1
            )
        );

        const first = Math.max(
            1,
            currentPage - 2
        );

        const last = Math.min(
            totalPages,
            currentPage + 2
        );

        for (
            let page = first;
            page <= last;
            page++
        ) {
            pagination!.appendChild(
                pageButton(
                    String(page),
                    page,
                    false,
                    page === currentPage
                )
            );
        }

        pagination!.appendChild(
            pageButton(
                labels.next,
                currentPage + 1,
                currentPage === totalPages
            )
        );

        const info = document.createElement("span");

        info.textContent =
            `${labels.page} ${currentPage} / ${totalPages}`;

        pagination!.appendChild(info);
    }

    // ============================================================
    // 重設全部條件
    // ============================================================

    resetButton?.addEventListener("click", () => {
        if (searchTimer !== undefined) {
            clearTimeout(searchTimer);
            searchTimer = undefined;
        }

        searchTimer = undefined;

        search!.value = "";
        sort!.value = defaultSort;

        if (playerFilter) playerFilter.value = "";
        if (timeFilter) timeFilter.value = "";
        if (weightFilter) weightFilter.value = "";
        if (mechanicFilter) mechanicFilter.value = "";
        if (accessoryFilter) accessoryFilter.value = "";

        activeFilter = capabilities.defaultFilter as GameListFilter;
        filterExplicit = false;
        selectedMechanic = "";
        selectedCategory = "";

        syncTagChips();

        currentPage = 1;

        filterButtons.forEach(item => {
            const active =
                item.dataset.gameFilter === "all";

            item.classList.toggle(
                "active",
                active
            );

            item.setAttribute(
                "aria-pressed",
                String(active)
            );
        });

        update();
        search!.focus();
    });

    root.querySelector("[data-game-clear-advanced]")?.addEventListener("click", event => {
        // The action lives inside the native summary; clearing must not toggle disclosure.
        event.stopPropagation();
        [playerFilter, timeFilter, weightFilter, mechanicFilter, accessoryFilter].forEach(select => { if (select) select.value = ""; });
        if (searchTimer !== undefined) clearTimeout(searchTimer);
        searchTimer = undefined;
        update();
        const button = event.currentTarget as HTMLButtonElement;
        if (button.hidden && document.activeElement === button) {
            root.querySelector<HTMLElement>("[data-game-advanced] summary")?.focus();
        }
    });

    // ============================================================
    // 標籤按鈕事件
    // ============================================================

    tagChips.forEach(chip => {
        chip.addEventListener("click", () => {
            const id = chip.dataset.tagId ?? "";

            if (!id) return;

            if (
                chip.dataset.tagKind === "mechanic"
            ) {
                selectedMechanic =
                    selectedMechanic === id
                        ? ""
                        : id;
            } else if (
                chip.dataset.tagKind === "category"
            ) {
                selectedCategory =
                    selectedCategory === id
                        ? ""
                        : id;
            }

            syncTagChips();

            if (searchTimer !== undefined) {
                clearTimeout(searchTimer);
                searchTimer = undefined;
            }

            update();
        });
    });

    // ============================================================
    // 收藏分類按鈕事件
    // ============================================================

    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            activeFilter = (
                button.dataset.gameFilter ?? "all"
            ) as GameListFilter;
            filterExplicit = true;
            if (accessoryFilter && activeFilter!=="accessory") accessoryFilter.value="";

            filterButtons.forEach(item => {
                const active = item === button;

                item.classList.toggle(
                    "active",
                    active
                );

                item.setAttribute(
                    "aria-pressed",
                    String(active)
                );
            });

            if (searchTimer !== undefined) {
                clearTimeout(searchTimer);
                searchTimer = undefined;
            }

            update();
        });
    });

    extraType?.addEventListener("change", () => {
        activeFilter = (extraType.value || capabilities.defaultFilter) as GameListFilter;
        filterExplicit = Boolean(extraType.value);
        if (searchTimer !== undefined) clearTimeout(searchTimer);
        searchTimer = undefined;
        update();
    });
    viewButtons.forEach(button => button.addEventListener("click", () => {
        const view = button.dataset.gameView;
        if (view !== "grid" && view !== "list" || !capabilities.views.includes(view)) return;
        if (searchTimer !== undefined) {
            clearTimeout(searchTimer);
            searchTimer = undefined;
            update(true, "replace");
        }
        viewMode = view;
        update(false);
    }));

    // ============================================================
    // 搜尋事件
    // ============================================================

    search.addEventListener("input", () => {
        if (searchTimer !== undefined) {
            clearTimeout(searchTimer);
            searchTimer = undefined;
        }

        searchTimer = setTimeout(
            () => { searchTimer = undefined; update(true, "replace"); },
            debounceMs
        );
    });

    // ============================================================
    // 排序事件
    // ============================================================

    sort.addEventListener("change", () => {
        if (searchTimer !== undefined) {
            clearTimeout(searchTimer);
            searchTimer = undefined;
        }

        update();
    });

    // ============================================================
    // 進階篩選事件
    // ============================================================

    [
        playerFilter,
        timeFilter,
        weightFilter,
        mechanicFilter, accessoryFilter
    ].forEach(select => {
        select?.addEventListener("change", () => {
            if (searchTimer !== undefined) {
                clearTimeout(searchTimer);
                searchTimer = undefined;
            }

            if (select===accessoryFilter && accessoryFilter?.value) { activeFilter="accessory"; filterExplicit=true; }
            update();
        });
    });

    // ============================================================
    // 初次顯示
    // ============================================================

    let restorePosition: { key: string; y: number; id?: string; offset?: number } | null = null;
    let restoringUntil = 0;
    function restoreScroll() {
        if (!progressive) return;
        const stored = window.history.state?.catalogScroll;
        if (!stored || stored.key !== location.pathname + location.search || !Number.isFinite(stored.y)) return;
        restorePosition = stored;
        restoringUntil = performance.now() + 3000;
        presentation?.layout();
    }
    function applyScroll() {
        if (!restorePosition || performance.now() > restoringUntil) return;
        const anchor = Array.from(grid!.children as HTMLCollectionOf<HTMLElement>).find(c=>(c.dataset.catalogKey??c.dataset.bggId)===restorePosition!.id);
        if (anchor && Number.isFinite(restorePosition.offset)) {
            window.scrollBy({ top: anchor.getBoundingClientRect().top - restorePosition.offset!, behavior: "instant" });
        } else window.scrollTo({ top: restorePosition.y, behavior: "instant" });
    }
    function rememberScroll() {
        if (!progressive) return;
        const anchor = Array.from(grid!.children as HTMLCollectionOf<HTMLElement>)
            .filter(card => card.getBoundingClientRect().bottom > 0)
            .sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top))[0];
        try {
            window.history.replaceState({ ...window.history.state, catalogScroll: {
                key: location.pathname + location.search, y: window.scrollY,
                id: anchor?.dataset.catalogKey??anchor?.dataset.bggId, offset: anchor?.getBoundingClientRect().top
            } }, "", location.href);
        } catch { /* Best-effort scroll evidence; URL filters remain usable. */ }
    }
    async function loadMore(manual = false) {
        if (!progressive || loading || currentPage * pageSize >= matchingCount || (!manual && autoLoadBlocked)) return;
        const token = generation, previous = currentPage;
        loading = true;
        if (loadButton) loadButton.disabled = true;
        if (loadStatus) loadStatus.textContent = locale === "en" ? "Loading…" : "載入中…";
        grid!.setAttribute("aria-busy", "true");
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (token !== generation) return;
        try {
            currentPage++;
            loading = false;
            update(false, "replace");
        } catch {
            currentPage = previous;
            saveUrl("replace");
            loading = false;
            autoLoadBlocked = true;
            if (loadButton) loadButton.disabled = false;
            if (loadStatus) loadStatus.textContent = locale === "en" ? "Could not load more. Use Load more to retry." : "載入失敗，請使用載入更多重試。";
        } finally { grid!.removeAttribute("aria-busy"); }
    }
    presentation?.onLayout(applyScroll);
    restoreUrl();
    if (root.dataset.liveCatalog) window.addEventListener("pageshow", event=>{if(event.persisted)location.reload();});
    const navigation = new AbortController();
    loadButton?.addEventListener("click", () => { autoLoadBlocked = false; void loadMore(true); });
    const observer = progressive && sentinel && typeof IntersectionObserver !== "undefined" ?
        new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMore(); }, { rootMargin: "400px" }) : null;
    if (sentinel) observer?.observe(sentinel);
    if (progressive) {
        window.addEventListener("scroll", () => { if (backTop) backTop.hidden = window.scrollY < 600; }, { passive: true, signal: navigation.signal });
        backTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
        for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(event, () => { restorePosition = null; }, { passive: true, signal: navigation.signal });
        root.addEventListener("click", event => {
            if ((event.target as Element).closest(".game-link[href]")) {
                if (searchTimer !== undefined) { clearTimeout(searchTimer); searchTimer = undefined; update(true, "replace"); }
                rememberScroll();
            }
        }, { capture: true, signal: navigation.signal });
    }
    window.addEventListener("popstate", () => {
        if (root.isConnected) restoreUrl();
    }, { signal: navigation.signal });
    window.addEventListener("pagehide", () => {
        if (searchTimer !== undefined) {
            clearTimeout(searchTimer);
            searchTimer = undefined;
            update(true, "replace");
        }
        rememberScroll();
    }, { signal: navigation.signal });
    document.addEventListener("astro:before-swap", () => {
        if (searchTimer !== undefined) {
            clearTimeout(searchTimer);
            searchTimer = undefined;
            update(true, "replace");
        }
        navigation.abort();
        observer?.disconnect();
        presentation?.destroy();
    }, { once: true, signal: navigation.signal });
}
