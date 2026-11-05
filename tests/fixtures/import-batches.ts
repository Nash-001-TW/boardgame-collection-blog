// Explicit historical projections: original acceptance counts remain unchanged.
// Current-cache acceptance is tested separately for each authorized import batch.
export const B41_IDS: readonly number[] = [238530,241622,244145,247331,247404,248199,252896,252897,252899,275585];
export const B42_IDS: readonly number[] = [279196,284354,295594,298128,301760,309374,316188,317014,318833,326045];
// B-4.3C committed the remaining nine; historical projections exclude exactly these ten.
export const B43_COMMITTED_IDS: readonly number[] = [340953,347147,347148,347149,348234,354504,358212,358213,359609,369493];
export const B44_IDS: readonly number[] = [377055,377056,379286,382509,382510,391772,394077,397102,405995,405996];
export const B45_IDS: readonly number[] = [405997,414602,414695,415432,420615,424487,428491,429274,432297,439466];
export const POST_B3C_IDS: readonly number[] = [...B41_IDS,...B42_IDS,...B43_COMMITTED_IDS,...B44_IDS,...B45_IDS];
export const POST_B1_IDS: readonly number[] = [226690,233977,237424,...POST_B3C_IDS];
