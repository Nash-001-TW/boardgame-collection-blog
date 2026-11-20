import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/** Only adapts a caller-owned disposable SQLite instance. No environment/config/database discovery. */
export function sqliteD1(sqlite: DatabaseSync): D1Database {
    function prepare(sql: string, args: SQLInputValue[] = []) {
        function execute() {
            const statement=sqlite.prepare(sql);
            if(statement.columns().length)return {success:true,results:statement.all(...args),meta:{}};
            const result=statement.run(...args);
            return {success:true,results:[],meta:{changes:result.changes,last_row_id:result.lastInsertRowid}};
        }
        return {
            bind:(...values:SQLInputValue[])=>prepare(sql,values),
            execute,
            all:async()=>execute(),
            run:async()=>execute(),
            first:async(column?:string)=>{
                const row=execute().results[0];
                return row?(column?row[column]:row):null;
            },
        };
    }
    return {
        prepare,
        async batch(statements: ReturnType<typeof prepare>[]) {
            sqlite.exec('BEGIN');
            try {
                const results=statements.map(statement=>statement.execute());
                sqlite.exec('COMMIT');return results;
            } catch(error) {sqlite.exec('ROLLBACK');throw error;}
        },
    } as unknown as D1Database;
}
