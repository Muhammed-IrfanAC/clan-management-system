/* eslint-disable @typescript-eslint/no-explicit-any -- a stand-in for an untyped query builder: rows are arbitrary JSON */
/**
 * In-memory stand-in for the supabase-js client, for testing the I/O modules (sync, …)
 * that the pure-module suites cannot reach.
 *
 * It implements the slice of the PostgREST query builder the app actually uses — select / insert /
 * upsert / update / delete, the common filters, single / maybeSingle, order / limit, count — and
 * two things a real database gives you that a hand-rolled mock usually doesn't:
 *
 *  - **Foreign keys** with ON DELETE rules (`restrict` | `cascade` | `set null`). A statement that
 *    violates one fails as a whole, exactly like Postgres, which is what makes a batched
 *    `delete().in(...)` die on a single referenced row.
 *  - **Fault injection** (`db.failNext` / `db.failWhen`) so a test can make one specific read or
 *    write error out and assert what the caller does with the `{ data: null, error }` it gets back.
 *
 * Embedded selects (`person:persons(access_role)`) are not resolved: a select containing `(` just
 * returns whole rows. Every executed statement is appended to `db.log` for assertions.
 */

type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
type Filter = (row: Row) => boolean;

export interface ForeignKey {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  onDelete: 'restrict' | 'cascade' | 'set null';
}

export interface DbError {
  message: string;
  code?: string;
}

interface Fault {
  table: string;
  op: Op;
  error: DbError;
  once: boolean;
  when?: (q: { table: string; op: Op; filters: string[] }) => boolean;
}

export interface LogEntry {
  table: string;
  op: Op;
  filters: string[];
  rows: number;
  error?: DbError;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  primaryKeys: Record<string, string> = {};
  defaults: Record<string, () => Row> = {};
  foreignKeys: ForeignKey[] = [];
  faults: Fault[] = [];
  log: LogEntry[] = [];
  private seq = 0;

  constructor(opts: { primaryKeys?: Record<string, string>; foreignKeys?: ForeignKey[]; defaults?: Record<string, () => Row> } = {}) {
    Object.assign(this.primaryKeys, opts.primaryKeys);
    this.foreignKeys.push(...(opts.foreignKeys ?? []));
    Object.assign(this.defaults, opts.defaults);
  }

  pk(table: string) {
    return this.primaryKeys[table] ?? 'id';
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  seed(table: string, rows: Row[]) {
    for (const r of rows) this.rows(table).push(this.withDefaults(table, r));
    return this;
  }

  find(table: string, pkValue: unknown): Row | undefined {
    const pk = this.pk(table);
    return this.rows(table).find((r) => r[pk] === pkValue);
  }

  /** Fail the next matching statement (then clear). */
  failNext(table: string, op: Op, message = 'injected failure', when?: Fault['when']) {
    this.faults.push({ table, op, error: { message }, once: true, when });
  }

  /** Fail every matching statement until `clearFaults()`. */
  failWhen(table: string, op: Op, message = 'injected failure', when?: Fault['when']) {
    this.faults.push({ table, op, error: { message }, once: false, when });
  }

  clearFaults() {
    this.faults = [];
  }

  takeFault(table: string, op: Op, filters: string[]): DbError | null {
    const i = this.faults.findIndex((f) => f.table === table && f.op === op && (!f.when || f.when({ table, op, filters })));
    if (i < 0) return null;
    const f = this.faults[i];
    if (f.once) this.faults.splice(i, 1);
    return f.error;
  }

  withDefaults(table: string, row: Row): Row {
    const pk = this.pk(table);
    const base = this.defaults[table]?.() ?? {};
    const out = { ...base, ...row };
    if (out[pk] === undefined) out[pk] = `${table}-${++this.seq}`;
    return out;
  }

  from(table: string) {
    return new QueryBuilder(this, table);
  }
}

class QueryBuilder implements PromiseLike<{ data: any; error: DbError | null; count?: number | null }> {
  private op: Op = 'select';
  private filters: Filter[] = [];
  private filterDesc: string[] = [];
  private payload: Row[] = [];
  private patch: Row = {};
  private returning = false;
  private selectCols = '*';
  private countMode: string | null = null;
  private head = false;
  private cardinality: 'many' | 'single' | 'maybeSingle' = 'many';
  private orderBy: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

  constructor(private db: FakeDb, private table: string) {}

  // ── verbs ──────────────────────────────────────────────────────────────
  select(cols = '*', opts: { count?: string; head?: boolean } = {}) {
    if (this.op === 'select') {
      this.selectCols = cols;
      this.countMode = opts.count ?? null;
      this.head = !!opts.head;
    } else {
      this.returning = true;
      this.selectCols = cols;
    }
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOpts = opts;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }

  // ── filters ────────────────────────────────────────────────────────────
  private add(desc: string, f: Filter) {
    this.filterDesc.push(desc);
    this.filters.push(f);
    return this;
  }
  eq(c: string, v: unknown) { return this.add(`${c}=eq.${v}`, (r) => r[c] === v); }
  neq(c: string, v: unknown) { return this.add(`${c}=neq.${v}`, (r) => r[c] !== v); }
  gt(c: string, v: any) { return this.add(`${c}=gt.${v}`, (r) => r[c] != null && r[c] > v); }
  gte(c: string, v: any) { return this.add(`${c}=gte.${v}`, (r) => r[c] != null && r[c] >= v); }
  lt(c: string, v: any) { return this.add(`${c}=lt.${v}`, (r) => r[c] != null && r[c] < v); }
  lte(c: string, v: any) { return this.add(`${c}=lte.${v}`, (r) => r[c] != null && r[c] <= v); }
  in(c: string, vs: unknown[]) {
    const set = new Set(vs);
    return this.add(`${c}=in.(${vs.length})`, (r) => set.has(r[c]));
  }
  is(c: string, v: null | boolean) { return this.add(`${c}=is.${v}`, (r) => (v === null ? r[c] == null : r[c] === v)); }
  not(c: string, op: string, v: unknown) {
    if (op === 'is' && v === null) return this.add(`${c}=not.is.null`, (r) => r[c] != null);
    if (op === 'in') {
      const list = Array.isArray(v) ? v : String(v).replace(/[()]/g, '').split(',');
      const set = new Set(list);
      return this.add(`${c}=not.in`, (r) => !set.has(r[c]));
    }
    if (op === 'eq') return this.add(`${c}=not.eq.${v}`, (r) => r[c] !== v);
    throw new Error(`FakeDb: unsupported not(${op})`);
  }

  // ── modifiers ──────────────────────────────────────────────────────────
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.cardinality = 'single';
    return this;
  }
  maybeSingle() {
    this.cardinality = 'maybeSingle';
    return this;
  }

  then<A = any, B = never>(
    onfulfilled?: ((v: { data: any; error: DbError | null; count?: number | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: any) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }

  // ── execution ──────────────────────────────────────────────────────────
  private matches(row: Row) {
    return this.filters.every((f) => f(row));
  }

  private project(rows: Row[]) {
    const cols = this.selectCols.trim();
    if (cols === '*' || cols.includes('(')) return rows.map((r) => ({ ...r }));
    const names = cols.split(',').map((c) => c.trim()).filter(Boolean);
    return rows.map((r) => Object.fromEntries(names.map((n) => [n, r[n] ?? null])));
  }

  private finish(rows: Row[], count?: number) {
    const entry: LogEntry = { table: this.table, op: this.op, filters: this.filterDesc, rows: rows.length };
    this.db.log.push(entry);
    let out = rows;
    for (const { col, asc } of [...this.orderBy].reverse()) {
      out = [...out].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)));
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    const data = this.project(out);
    const countField = this.countMode ? { count: count ?? rows.length } : {};
    if (this.head) return { data: null, error: null, ...countField };
    if (this.cardinality === 'single') {
      if (data.length !== 1) {
        return { data: null, error: { message: `JSON object requested, ${data.length} rows returned`, code: 'PGRST116' }, ...countField };
      }
      return { data: data[0], error: null, ...countField };
    }
    if (this.cardinality === 'maybeSingle') {
      if (data.length > 1) return { data: null, error: { message: 'multiple rows returned', code: 'PGRST116' } };
      return { data: data[0] ?? null, error: null, ...countField };
    }
    if (this.op !== 'select' && !this.returning) return { data: null, error: null };
    return { data, error: null, ...countField };
  }

  private fail(error: DbError) {
    this.db.log.push({ table: this.table, op: this.op, filters: this.filterDesc, rows: 0, error });
    return { data: null, error, count: null };
  }

  private execute() {
    const fault = this.db.takeFault(this.table, this.op, this.filterDesc);
    if (fault) return this.fail(fault);

    const table = this.db.rows(this.table);
    const pk = this.db.pk(this.table);

    switch (this.op) {
      case 'select':
        return this.finish(table.filter((r) => this.matches(r)));

      case 'insert': {
        const rows = this.payload.map((r) => this.db.withDefaults(this.table, r));
        for (const r of rows) {
          if (table.some((t) => t[pk] === r[pk])) return this.fail({ message: `duplicate key value violates unique constraint "${this.table}_pkey"`, code: '23505' });
          const fk = this.checkOutgoingFks(r);
          if (fk) return this.fail(fk);
        }
        table.push(...rows);
        return this.finish(rows);
      }

      case 'upsert': {
        const key = this.upsertOpts.onConflict ?? pk;
        // PostgREST sends one column set for the whole batch: keys missing from a row are written
        // as NULL (supabase-js defaultToNull), which is why heterogeneous upsert batches are risky.
        const columns = new Set(this.payload.flatMap((r) => Object.keys(r)));
        const written: Row[] = [];
        const staged = table.map((r) => ({ ...r }));
        for (const raw of this.payload) {
          const row: Row = {};
          for (const c of columns) row[c] = c in raw ? raw[c] : null;
          const i = staged.findIndex((t) => t[key] === row[key]);
          if (i >= 0) {
            if (this.upsertOpts.ignoreDuplicates) continue;
            staged[i] = { ...staged[i], ...row };
            written.push(staged[i]);
          } else {
            const fresh = this.db.withDefaults(this.table, row);
            staged.push(fresh);
            written.push(fresh);
          }
        }
        for (const r of written) {
          const fk = this.checkOutgoingFks(r);
          if (fk) return this.fail(fk);
        }
        table.splice(0, table.length, ...staged);
        return this.finish(written);
      }

      case 'update': {
        const hit = table.filter((r) => this.matches(r));
        for (const r of hit) {
          const fk = this.checkOutgoingFks({ ...r, ...this.patch });
          if (fk) return this.fail(fk);
        }
        for (const r of hit) Object.assign(r, this.patch);
        return this.finish(hit);
      }

      case 'delete': {
        const hit = table.filter((r) => this.matches(r));
        const err = this.cascadeDelete(this.table, hit);
        if (err) return this.fail(err);
        return this.finish(hit);
      }
    }
  }

  private checkOutgoingFks(row: Row): DbError | null {
    for (const fk of this.db.foreignKeys.filter((f) => f.table === this.table)) {
      const v = row[fk.column];
      if (v == null) continue;
      if (!this.db.rows(fk.refTable).some((r) => r[fk.refColumn] === v)) {
        return { message: `insert or update on table "${fk.table}" violates foreign key constraint "${fk.table}_${fk.column}_fkey"`, code: '23503' };
      }
    }
    return null;
  }

  /** Apply a delete atomically: either every row (and its cascades) goes, or nothing does. */
  private cascadeDelete(tableName: string, victims: Row[]): DbError | null {
    const plan: { table: string; rows: Set<Row> }[] = [];
    const nulls: { row: Row; column: string }[] = [];
    const visit = (t: string, rows: Row[]): DbError | null => {
      if (rows.length === 0) return null;
      plan.push({ table: t, rows: new Set(rows) });
      for (const fk of this.db.foreignKeys.filter((f) => f.refTable === t)) {
        const keys = new Set(rows.map((r) => r[fk.refColumn]));
        const refs = this.db.rows(fk.table).filter((r) => keys.has(r[fk.column]));
        if (refs.length === 0) continue;
        if (fk.onDelete === 'restrict') {
          return { message: `update or delete on table "${t}" violates foreign key constraint "${fk.table}_${fk.column}_fkey" on table "${fk.table}"`, code: '23503' };
        }
        if (fk.onDelete === 'set null') refs.forEach((row) => nulls.push({ row, column: fk.column }));
        if (fk.onDelete === 'cascade') {
          const err = visit(fk.table, refs);
          if (err) return err;
        }
      }
      return null;
    };
    const err = visit(tableName, victims);
    if (err) return err;
    for (const { row, column } of nulls) row[column] = null;
    for (const { table, rows } of plan) {
      const t = this.db.rows(table);
      t.splice(0, t.length, ...t.filter((r) => !rows.has(r)));
    }
    return null;
  }
}

/**
 * A FakeDb pre-wired with the production schema's keys and the foreign keys that matter for the
 * account / person lifecycle, with the ON DELETE rules as they are in production today (read from
 * pg_constraint, not from the migration files, which have drifted: warnings → player_accounts is
 * NO ACTION in prod).
 */
export function createClanOpsDb() {
  return new FakeDb({
    primaryKeys: { player_accounts: 'player_tag', settings: 'key', kicked_accounts: 'player_tag' },
    defaults: {
      persons: () => ({ access_role: null, created_at: new Date().toISOString() }),
      player_accounts: () => ({ person_id: null, added_at: new Date().toISOString() }),
    },
    foreignKeys: [
      { table: 'player_accounts', column: 'person_id', refTable: 'persons', refColumn: 'id', onDelete: 'restrict' },
      { table: 'player_accounts', column: 'clan_id', refTable: 'clans', refColumn: 'id', onDelete: 'restrict' },
      { table: 'warnings', column: 'player_account_tag', refTable: 'player_accounts', refColumn: 'player_tag', onDelete: 'restrict' },
      { table: 'warnings', column: 'person_id', refTable: 'persons', refColumn: 'id', onDelete: 'cascade' },
      { table: 'strikes', column: 'player_account_tag', refTable: 'player_accounts', refColumn: 'player_tag', onDelete: 'set null' },
      { table: 'strikes', column: 'person_id', refTable: 'persons', refColumn: 'id', onDelete: 'cascade' },
      { table: 'cwl_allocations', column: 'player_account_tag', refTable: 'player_accounts', refColumn: 'player_tag', onDelete: 'cascade' },
      { table: 'member_notes', column: 'person_id', refTable: 'persons', refColumn: 'id', onDelete: 'cascade' },
      { table: 'kicked_accounts', column: 'player_tag', refTable: 'player_accounts', refColumn: 'player_tag', onDelete: 'restrict' },
      { table: 'kicked_accounts', column: 'kicked_from_clan_id', refTable: 'clans', refColumn: 'id', onDelete: 'set null' },
    ],
  });
}
