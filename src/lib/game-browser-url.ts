/** URL metadata only; never reads collection records or contacts a service. */
export interface BrowserUrlState {
    accessory?: string;
    q: string;
    filter: string;
    filterExplicit: boolean;
    view: "grid" | "list";
    sort: string;
    players: string;
    time: string;
    weight: string;
    mechanic: string;
    tagMechanic: string;
    category: string;
    page: number;
}

export interface BrowserUrlChoices {
    accessories?: string[];
    parameters?: readonly string[];
    defaultSort: string;
    defaultFilter?: string;
    views?: string[];
    filters: string[];
    sorts: string[];
    players: string[];
    times: string[];
    weights: string[];
    mechanics: string[];
    mechanicTags: string[];
    categories: string[];
}

const keys = ["q", "filter", "sort", "players", "time", "weight",
    "mechanic", "tagMechanic", "category", "page", "view", "accessory"] as const;

export function readBrowserUrl(url: URL, choices: BrowserUrlChoices): BrowserUrlState {
    const pick = (key: string, allowed: string[], fallback = "") => {
        if (choices.parameters && !choices.parameters.includes(key)) return fallback;
        const value = url.searchParams.get(key) ?? "";
        return allowed.includes(value) ? value : fallback;
    };
    const page = url.searchParams.get("page") ?? "1";
    const number = Number(page);
    return {
        ...(choices.accessories ? {accessory:pick("accessory",choices.accessories)} : {}),
        q: (url.searchParams.get("q") ?? "").trim().slice(0, 200),
        filter: pick("filter", choices.filters, choices.defaultFilter ?? "all"),
        filterExplicit: (!choices.parameters || choices.parameters.includes("filter")) &&
            url.searchParams.has("filter") && choices.filters.includes(url.searchParams.get("filter")!),
        view: pick("view", choices.views ?? ["grid"], "grid") as "grid" | "list",
        sort: pick("sort", choices.sorts, choices.defaultSort),
        players: pick("players", choices.players),
        time: pick("time", choices.times),
        weight: pick("weight", choices.weights),
        mechanic: pick("mechanic", choices.mechanics),
        tagMechanic: pick("tagMechanic", choices.mechanicTags),
        category: pick("category", choices.categories),
        page: /^[1-9][0-9]*$/.test(page) && Number.isSafeInteger(number) ? number : 1
    };
}

/** Own only our query keys; preserve other parameters, pathname and hash. */
export function writeBrowserUrl(url: URL, state: BrowserUrlState, defaultSort: string,
    parameters: readonly string[] = keys, defaultFilter = "all"): URL {
    const next = new URL(url.href);
    keys.forEach(key => { if (key !== 'accessory' || parameters.includes(key)) next.searchParams.delete(key); });
    for (const key of keys) {
        if (!parameters.includes(key)) continue;
        const value = state[key];
        if (!value || (key === "page" && value === 1) ||
            (key === "view" && value === "grid") ||
            (key === "filter" && !state.filterExplicit && value === defaultFilter) ||
            (key === "sort" && value === defaultSort)) continue;
        next.searchParams.set(key, String(value));
    }
    return next;
}

/** The remembered selection and the effective search scope are deliberately separate. */
export function getEffectiveBrowserFilter(
    state: Pick<BrowserUrlState, "q" | "filter" | "filterExplicit">,
    searchAllTypesByDefault: boolean
): string {
    return searchAllTypesByDefault && !state.filterExplicit && state.q.trim() ? "all" : state.filter;
}
