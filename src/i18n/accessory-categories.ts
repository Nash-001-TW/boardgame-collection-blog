import type { AccessoryCategory } from '../lib/notbgg-contract';
export const publicAccessoryLabels: Record<AccessoryCategory, readonly [string,string]> = {
    upgrade: ['升級配件','Upgrade'], playmat: ['地圖墊／遊戲墊','Playmat'], storage: ['收納盒','Storage'],
    promo: ['贈品／特典','Promo'], sleeves: ['卡牌保護','Sleeves'], miniatures: ['模型','Miniatures'], tokens: ['骰子／指示物','Tokens'], other: ['其他','Other']
};
