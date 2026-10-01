export interface Game {
    bggId: number;
    name: string;
    slug: string;
    year: number;
    players: string;
    playTime: string;
    myRating: number;
}

export const games: Game[] = [
    {
        bggId: 194655,
        name: "Santorini",
        slug: "santorini",
        year: 2016,
        players: "2–4",
        playTime: "20 分鐘",
        myRating: 8.8
    },
    {
        bggId: 0,
        name: "TEND",
        slug: "tend",
        year: 2025,
        players: "1–4",
        playTime: "60–120 分鐘",
        myRating: 8.5
    },
    {
        bggId: 0,
        name: "ONWARD",
        slug: "onward",
        year: 2025,
        players: "1–4",
        playTime: "60–120 分鐘",
        myRating: 9.0
    },
    {
    bggId: 295770,
    name: "Frosthaven",
    slug: "frosthaven",
    year: 2022,
    players: "1–4",
    playTime: "30–120 分鐘",
    myRating: 9.5
    }
];