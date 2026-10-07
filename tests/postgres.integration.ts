import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { readStore, transact } from "../src/lib/store";
import { closeDatabase, pg, usesPostgres } from "../src/lib/database";
import { acquireLease, runOperation, operation } from "../src/lib/operations";
import { publishAsset, getAsset } from "../src/lib/assets";
import { enqueue, beginGame, finish, emptyStore } from "../src/lib/game";
import { migrateSqlite } from "../src/lib/migrate-sqlite";

// Deliberately separate from npm test; never run destructive setup on a cloud URL.
const uri = new URL(process.env.RING_TEST_DATABASE_URL || "http://missing");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname) ||
  uri.pathname !== "/ring_test"
)
  throw new Error(
    "Set RING_TEST_DATABASE_URL to a disposable localhost database named ring_test.",
  );
const admin = postgres(uri.toString(), { max: 1, onnotice: () => {} });
const login = `ring_test_${randomUUID().replaceAll("-", "")}`;
let initialized = false;
before(async () => {
  const [existing] =
    await admin`select 1 from pg_namespace where nspname='ring'`;
  assert.equal(
    existing,
    undefined,
    "The disposable database must not already contain Ring data.",
  );
  await admin.unsafe(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$;`);
  await admin.unsafe(
    readFileSync(
      "supabase/migrations/20261007181502_ring_private_backend.sql",
      "utf8",
    ),
  );
  initialized = true;
  await admin.unsafe(
    `create role "${login}" login nosuperuser nocreatedb nocreaterole inherit; grant ring_backend to "${login}";`,
  );
  uri.username = login;
  process.env.RING_DATABASE_URL = uri.toString();
  process.env.RING_STORAGE = "postgres";
  process.env.RING_ASSET_ORIGIN = "https://ring.test";
});
after(async () => {
  await closeDatabase();
  if (initialized) {
    await admin.unsafe("drop schema ring cascade");
    await admin.unsafe(`drop role if exists "${login}"`);
  }
  await admin.end();
});

test("configured Postgres fails closed without a URL", () => {
  const saved = process.env.RING_DATABASE_URL;
  delete process.env.RING_DATABASE_URL;
  assert.equal(usesPostgres(), true);
  assert.throws(() => pg(), /RING_DATABASE_URL/);
  process.env.RING_DATABASE_URL = saved;
});

test("parallel state changes serialize without lost writes and failed transitions roll back", async () => {
  await Promise.all(
    Array.from({ length: 30 }, () =>
      transact((s) => {
        s.wins++;
      }),
    ),
  );
  assert.equal((await readStore()).wins, 30);
  await assert.rejects(
    transact((s) => {
      s.wins = 999;
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal((await readStore()).wins, 30);
  await assert.rejects(
    transact(async (s) => {
      s.wins = 1000;
    }),
    /synchronous/,
  );
  assert.equal((await readStore()).wins, 30);
});

test("SQLite cutover preserves retired facts and signed bytes and refuses an occupied destination", async () => {
  await admin`delete from ring.state`;
  const file = join(
    mkdtempSync(join(tmpdir(), "ring-cutover-")),
    "source.sqlite",
  );
  const local = new DatabaseSync(file);
  const state = emptyStore();
  state.questions.push({
    id: "used",
    fact: "retired",
    text: "Already asked",
    choices: ["A", "B", "C", "D"],
    correct: 0,
    source: "https://example.com",
    used: true,
  });
  state.wallets.caller = {
    username: "caller",
    cooldownUntil: Date.now() + 600000,
  };
  state.voiceHeartbeat = Date.now();
  local.exec(
    "create table ring_state(id integer primary key,body text); create table operations(id text,intent text,body text); create table assets(id text,mime text,bytes blob);",
  );
  local
    .prepare("insert into ring_state values(1,?)")
    .run(JSON.stringify(state));
  local
    .prepare("insert into operations values(?,?,?)")
    .run(
      "cutover",
      "intent",
      JSON.stringify({
        raw: "signed",
        signature: "sig",
        status: "signed",
        lastValidBlockHeight: 20,
      }),
    );
  local
    .prepare("insert into assets values(?,?,?)")
    .run("a".repeat(64), "image/png", Buffer.from("bytes"));
  local.close();
  assert.equal((await migrateSqlite(file)).applied, false);
  assert.equal((await admin`select * from ring.state`).length, 0);
  const result = await migrateSqlite(file, true);
  assert.equal(result.retired, 1);
  assert.equal((await readStore()).questions[0].used, true);
  assert.equal(
    (await readStore()).wallets.caller.cooldownUntil,
    state.wallets.caller.cooldownUntil,
  );
  assert.equal((await readStore()).voiceHeartbeat, undefined);
  assert.equal((await operation("cutover"))?.raw, "signed");
  assert.equal(
    Buffer.from((await getAsset("a".repeat(64)))!.bytes).toString(),
    "bytes",
  );
  await assert.rejects(migrateSqlite(file, true), /Destination is not empty/);
  await admin`delete from ring.state`;
  await admin`delete from ring.operations`;
  await admin`delete from ring.assets`;
});

test("racing callbacks reserve questions once and another caller cannot overlap", async () => {
  const codes = await transact((s) => {
    s.wins = 0;
    s.questions = Array.from({ length: 12 }, (_, i) => ({
      id: `q${i}`,
      fact: `f${i}`,
      text: `Question ${i}`,
      choices: ["A", "B", "C", "D"],
      correct: 0,
      source: "https://example.com",
      used: false,
    }));
    return ["one", "two"].map((wallet) => {
      s.wallets[wallet] = { username: wallet, cooldownUntil: 0 };
      s.proposals.push({
        id: wallet,
        wallet,
        username: wallet,
        title: "Change description",
        kind: "description",
        value: "Ring!",
        note: "",
        status: "open",
        comments: 0,
        createdAt: Date.now(),
      });
      return enqueue(s, wallet, wallet).code;
    });
  });
  const games = await Promise.all(
    Array.from({ length: 8 }, () =>
      transact((s) => beginGame(s, codes[0], "same-call")),
    ),
  );
  assert.equal(new Set(games.map((g) => g.id)).size, 1);
  assert.equal((await readStore()).questions.filter((q) => q.used).length, 3);
  await assert.rejects(transact((s) => beginGame(s, codes[1], "second-call")));
  await transact((s) => finish(s, s.games[0], "lost"));
  const second = await transact((s) => beginGame(s, codes[1], "second-call"));
  assert.equal(
    second.questions.some((q) =>
      games[0].questions.some((first) => first.id === q.id),
    ),
    false,
  );
});

test("database-clock leases have one owner and expired owners cannot renew", async () => {
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () => acquireLease("parallel")),
  );
  const owners = attempts.filter((x) => x !== null);
  assert.equal(owners.length, 1);
  await owners[0].renew();
  await owners[0].release();
  const stale = await acquireLease("expiry", 20);
  assert.ok(stale);
  await admin`select pg_sleep(0.04)`;
  const replacement = await acquireLease("expiry");
  assert.ok(replacement);
  await assert.rejects(stale.renew(), /lease lost/);
  await stale.release();
  assert.equal(await acquireLease("expiry"), null);
  await replacement.release();
});

test("signed bytes survive reconnect and assets remain immutable", async () => {
  let final = false;
  const transport = {
    status: async () => (final ? ("finalized" as const) : ("missing" as const)),
    finalizedHeight: async () => 1,
    send: async () => {},
  };
  await runOperation("recovery", { recipient: "A" }, transport, async () => ({
    raw: "bytes",
    signature: "sig",
    lastValidBlockHeight: 20,
  }));
  await closeDatabase();
  assert.equal((await operation("recovery"))?.raw, "bytes");
  final = true;
  assert.equal(
    await runOperation("recovery", { recipient: "A" }, transport, async () => {
      throw new Error("must not rebuild");
    }),
    "sig",
  );
  const url = await publishAsset(Buffer.from("image"), "image/png");
  assert.equal(await publishAsset(Buffer.from("image"), "image/png"), url);
  assert.equal(
    Buffer.from((await getAsset(url.split("/").pop()!))!.bytes).toString(),
    "image",
  );
  await assert.rejects(
    pg()`update ring.assets set mime='image/jpeg'`,
    /permission denied/,
  );
  await assert.rejects(pg()`delete from ring.state`, /permission denied/);
});

test("anonymous clients have no schema access; RLS still hides data if select is accidentally granted", async () => {
  await assert.rejects(
    admin.begin(async (tx) => {
      await tx`set local role anon`;
      await tx`select * from ring.state`;
    }),
    /permission denied/,
  );
  await admin.begin(async (tx) => {
    await tx`grant usage on schema ring to anon`;
    await tx`grant select on ring.state to anon`;
    await tx`set local role anon`;
    const rows = await tx`select * from ring.state`;
    assert.equal(rows.length, 0);
    await tx`reset role`;
    await tx`revoke select on ring.state from anon`;
    await tx`revoke usage on schema ring from anon`;
  });
});
