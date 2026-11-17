import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileMailTemplate, draw, parsePlayers } from "./utils.mjs";

// Deterministic PRNG (mulberry32) so that failures are reproducible.
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds players from names; nested arrays are groups.
const toEntry = (spec) =>
  Array.isArray(spec)
    ? spec.map(toEntry)
    : { name: spec, email: "x@example.com" };
const makePlayers = (spec) => parsePlayers(JSON.stringify(spec.map(toEntry)));

const drawLottery = (...args) => draw(...args).lottery;

function assertValid(players, lottery) {
  const ids = Object.keys(players);
  assert.deepEqual(Object.keys(lottery).sort(), ids.slice().sort());
  assert.deepEqual(Object.values(lottery).sort(), ids.slice().sort());
  for (const [source, target] of Object.entries(lottery)) {
    assert(!players[source].excluded.has(target), `${source} → ${target}`);
    assert.notEqual(lottery[target], source, `${source} ↔ ${target}`);
  }
}

function* permutations(array) {
  if (array.length <= 1) {
    yield array;
    return;
  }
  for (let i = 0; i < array.length; ++i) {
    const rest = [...array.slice(0, i), ...array.slice(i + 1)];
    for (const p of permutations(rest)) {
      yield [array[i], ...p];
    }
  }
}

function bruteForceExists(players) {
  const ids = Object.keys(players);
  for (const targets of permutations(ids)) {
    const lottery = Object.fromEntries(ids.map((id, i) => [id, targets[i]]));
    if (
      ids.every(
        (id) =>
          !players[id].excluded.has(lottery[id]) && lottery[lottery[id]] !== id,
      )
    ) {
      return true;
    }
  }
  return false;
}

describe("parsePlayers", () => {
  it("excludes nested group members in both directions", () => {
    const players = makePlayers([[["X", "Y"], "Z"], "W"]);
    assert.deepEqual([...players.X.excluded].sort(), ["X", "Y", "Z"]);
    assert.deepEqual([...players.Z.excluded].sort(), ["X", "Y", "Z"]);
    assert.deepEqual([...players.W.excluded], ["W"]);
  });

  it("skips non-participating players, even in groups", () => {
    const players = parsePlayers(`[[
      { name: "A", email: "a" },
      { name: "B", email: "b", participate: false },
    ]]`);
    assert.deepEqual(Object.keys(players), ["A"]);
    assert.deepEqual([...players.A.excluded], ["A"]);
  });

  it("uses the disambiguated name as default id", () => {
    const players = parsePlayers(
      `[{ name: "A", disambiguation: "junior", email: "a" }]`,
    );
    assert.deepEqual(Object.keys(players), ["A (junior)"]);
  });

  it("rejects duplicate ids", () => {
    assert.throws(() => makePlayers(["A", "A"]), /duplicate player id: A/);
  });

  it("converts ids to strings", () => {
    const players = parsePlayers(`[{ id: 1, name: "A", email: "a" }]`);
    assert.equal(players[1].id, "1");
  });

  it("supports ids colliding with object properties", () => {
    const players = makePlayers(["size", "has", "__proto__", "constructor"]);
    assert.deepEqual(Object.keys(players), [
      "size",
      "has",
      "__proto__",
      "constructor",
    ]);
    assertValid(players, drawLottery(players, {}, { random: seededRandom(0) }));
  });
});

describe("draw", () => {
  const specs = [
    ["A", "B", "C"],
    ["A", "B", "C", "D"],
    [["A", "B"], ["C", "D"], "E"],
    [[["A", "B"], "C"], ["D", "E"], "F", "G"],
    [["A", "B", "C"], ["D", "E", "F"], "G"],
  ];

  for (const spec of specs) {
    it(`gives a valid draw for ${JSON.stringify(spec)}`, () => {
      const players = makePlayers(spec);
      for (let seed = 0; seed < 500; ++seed) {
        assertValid(
          players,
          drawLottery(players, {}, { random: seededRandom(seed) }),
        );
      }
    });
  }

  it("draws uniformly among valid draws", () => {
    // 4 players: the 6 cycles of length 4 are the only valid draws.
    const players = makePlayers(["A", "B", "C", "D"]);
    const counts = new Map();
    for (let seed = 0; seed < 6000; ++seed) {
      const key = JSON.stringify(
        drawLottery(players, {}, { random: seededRandom(seed) }),
      );
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    assert.equal(counts.size, 6);
    for (const count of counts.values()) {
      assert(count > 850 && count < 1150, `count: ${count}`);
    }
  });

  it("falls back to a search when sampling finds nothing", () => {
    // With random() = 0 the shuffle only rotates the targets, and every
    // rotation is invalid here, so only the search can succeed.
    const players = makePlayers([["A", "B"], "C", "D"]);
    assertValid(players, drawLottery(players, {}, { random: () => 0 }));
  });

  it("agrees with brute force on small games", () => {
    const random = seededRandom(42);
    for (let i = 0; i < 300; ++i) {
      // Random games of up to 6 players in random groups.
      const spec = [];
      const n = 1 + Math.floor(random() * 6);
      for (let j = 0; j < n; ++j) {
        const name = String.fromCharCode(65 + j);
        if (spec.length !== 0 && random() < 0.4) {
          const last = spec.at(-1);
          spec[spec.length - 1] = Array.isArray(last)
            ? [...last, name]
            : [last, name];
        } else {
          spec.push(name);
        }
      }
      const players = makePlayers(spec);
      const message = JSON.stringify(spec);
      if (bruteForceExists(players)) {
        assertValid(players, drawLottery(players, {}, { random }));
      } else {
        assert.throws(
          () => drawLottery(players, {}, { random }),
          /no valid draw/,
          message,
        );
      }
    }
  });

  it("fails fast on impossible games", () => {
    const group = Array.from({ length: 21 }, (_, i) => `G${i}`);
    const others = Array.from({ length: 19 }, (_, i) => `O${i}`);
    const players = makePlayers([group, ...others]);
    assert.throws(() => drawLottery(players), /no valid draw exists/);
  });

  it("completes an existing lottery without reciprocal pairs", () => {
    const players = makePlayers(["A", "B", "C", "D", "E", "F"]);
    for (let seed = 0; seed < 500; ++seed) {
      const lottery = drawLottery(
        players,
        { A: "B" },
        { random: seededRandom(seed) },
      );
      assert.equal(lottery.A, "B");
      assertValid(players, lottery);
    }
  });
});

describe("draw with an existing lottery", () => {
  const six = ["A", "B", "C", "D", "E", "F"];

  it("keeps it when complete", () => {
    const players = makePlayers(six);
    const previous = { ...drawLottery(players) };
    const result = draw(players, previous);
    assert.deepEqual({ ...result.lottery }, previous);
    assert.deepEqual(result.notify, []);
  });

  it("drops pairs of players who left and redraws their sources", () => {
    for (let seed = 0; seed < 200; ++seed) {
      const random = seededRandom(seed);
      const previous = {
        ...drawLottery(makePlayers([...six, "X"]), {}, { random }),
      };
      const players = makePlayers(six);
      const { lottery, dropped, notify } = draw(players, previous, { random });
      assertValid(players, lottery);
      assert.deepEqual(
        dropped.sort(),
        Object.entries(previous)
          .filter((pair) => pair.includes("X"))
          .sort(),
      );
      const giverToX = dropped.find(([, target]) => target === "X")[0];
      assert.equal(notify[0], giverToX);
      // Another pair is redrawn only when Y → X → Z → Y left Y ↔ Z.
      if (previous[previous.X] === giverToX) {
        assert(notify.length > 1);
      } else {
        assert.equal(notify.length, 1);
      }
      for (const [source, target] of Object.entries(previous)) {
        if (source !== "X" && !notify.includes(source)) {
          assert.equal(lottery[source], target);
        }
      }
    }
  });

  it("inserts a new player into a complete lottery", () => {
    for (let seed = 0; seed < 200; ++seed) {
      const random = seededRandom(seed);
      const previous = { ...drawLottery(makePlayers(six), {}, { random }) };
      const players = makePlayers([...six, "N"]);
      const { lottery, notify } = draw(players, previous, { random });
      assertValid(players, lottery);
      const giverToN = Object.keys(lottery).find((id) => lottery[id] === "N");
      assert.deepEqual(notify.sort(), [giverToN, "N"].sort());
      assert.equal(lottery.N, previous[giverToN]);
      for (const [source, target] of Object.entries(previous)) {
        if (source !== giverToN) {
          assert.equal(lottery[source], target);
        }
      }
    }
  });

  it("rejects pairs breaking the current rules", () => {
    const players = makePlayers([["A", "B"], "C", "D"]);
    assert.throws(() => draw(players, { A: "B" }), /existing pairs.*A → B/);
    assert.throws(() => draw(players, { A: "A" }), /existing pairs/);
    assert.throws(() => draw(players, { C: "D", D: "C" }), /existing pairs/);
    assert.throws(() => draw(players, { A: "C", B: "C" }), /existing pairs/);
  });
});

describe("compileMailTemplate", () => {
  it("renders fields, text and HTML", () => {
    const render = compileMailTemplate(
      [
        "---",
        "subject: Gift for {{player.name}}",
        "bcc: { name: Me, address: me@example.com }",
        "---",
        "Hi {{player.name}}, you give to **{{target.name}}**.",
      ].join("\n"),
    );
    assert.deepEqual(
      render({ player: { name: "Tom & Jerry" }, target: { name: "<b>A</b>" } }),
      {
        subject: "Gift for Tom & Jerry",
        bcc: { name: "Me", address: "me@example.com" },
        text: "Hi Tom & Jerry, you give to **<b>A</b>**.",
        html: "<p>Hi Tom &amp; Jerry, you give to <strong>&lt;b&gt;A&lt;/b&gt;</strong>.</p>\n",
      },
    );
  });
});
