import { expect, test } from "bun:test";

import { SqliteD1Database } from "./helpers/sqlite-d1";

test("serialized SQLite clones isolate data and transactions", async () => {
  const template = new SqliteD1Database();
  template.execute("CREATE TABLE item (id integer PRIMARY KEY)");
  const bytes = template.serialize();
  const first = new SqliteD1Database({ serialized: bytes });
  const second = new SqliteD1Database({ serialized: bytes });

  await expect(
    first.batch([
      first.prepare("INSERT INTO item (id) VALUES (1)"),
      first.prepare("INSERT INTO item (id) VALUES (1)"),
    ]),
  ).rejects.toThrow();
  await first.prepare("INSERT INTO item (id) VALUES (2)").run();

  await expect(first.prepare("SELECT id FROM item").all()).resolves.toMatchObject({
    results: [{ id: 2 }],
  });
  await expect(second.prepare("SELECT id FROM item").all()).resolves.toMatchObject({ results: [] });
});
