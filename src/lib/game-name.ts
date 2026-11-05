import { decodeHTMLStrict } from "entities";

/** Decode raw source names once at the text-display boundary, never as trusted HTML.
 * Do not apply to an already rendered name, IDs, slugs, URLs or HTML descriptions.
 * Nested encodings intentionally receive only one pass.
 */
export function decodeGameName(rawName: string): string {
    return decodeHTMLStrict(rawName);
}
