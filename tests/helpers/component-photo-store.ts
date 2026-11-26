export function memoryPhotoStore() {
    const objects = new Map<string, ArrayBuffer>();
    const deleted: string[] = [];
    return {
        objects, deleted,
        async put(key: string, value: ArrayBuffer) { objects.set(key, value.slice(0)); },
        async get(key: string) {
            const data = objects.get(key);
            return data ? { body: new Response(data).body! } : null;
        },
        async delete(key: string) { deleted.push(key); objects.delete(key); },
    };
}
