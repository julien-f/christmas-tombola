import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  compileMailTemplate,
  compileTextTemplate,
  createGlobMatcher,
  draw,
  hideTarget,
  parsePlayers,
  namePattern,
  shellQuote,
  unmatchedPatterns,
  unreachablePlayers,
} from "./utils.mjs";

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

  it("lists players without contact, unless told in person", () => {
    const players = parsePlayers(`[
      { name: "A", email: "a" },
      { name: "B", phone: "+1" },
      { name: "C" },
      { name: "D", inPerson: true },
    ]`);
    assert.deepEqual(unreachablePlayers(players), [players.C]);
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

  it("gives a valid draw for large groups", () => {
    // Sampling almost never succeeds here, so the search does the work.
    const group = (name) => Array.from({ length: 10 }, (_, i) => name + i);
    const players = makePlayers([group("A"), group("B"), group("C")]);
    for (let seed = 0; seed < 10; ++seed) {
      assertValid(
        players,
        drawLottery(players, {}, { random: seededRandom(seed) }),
      );
    }
  });

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

      // A random previous lottery, with a player X who left and pairs
      // breaking any rule.
      const previousIds = [...Object.keys(players), "X"];
      const pick = () => previousIds[Math.floor(random() * previousIds.length)];
      const previous = {};
      for (const id of previousIds) {
        if (random() < 0.5) {
          previous[id] = pick();
        }
      }

      const message = JSON.stringify({ spec, previous });
      if (!bruteForceExists(players)) {
        assert.throws(
          () => draw(players, previous, { random }),
          /no valid draw exists/,
          message,
        );
        continue;
      }

      const { lottery, dropped, notify } = draw(players, previous, { random });
      assertValid(players, lottery);

      const isDropped = ([source]) => dropped.some(([s]) => s === source);
      const kept = Object.entries(previous).filter((pair) => !isDropped(pair));
      assert.deepEqual(
        [...kept, ...dropped].sort(),
        Object.entries(previous).sort(),
        message,
      );
      const isValid = ([source, target]) =>
        source in players &&
        target in players &&
        !players[source].excluded.has(target);
      for (const [source, target] of kept) {
        assert(isValid([source, target]), message);
        assert(
          !kept.some(([s, t]) => t === target && s !== source),
          `duplicate target: ${message}`,
        );
        assert(
          !kept.some(([s, t]) => s === target && t === source),
          `reciprocal: ${message}`,
        );
      }
      for (const [source, target] of dropped) {
        assert(
          !isValid([source, target]) ||
            kept.some(
              ([s, t]) => t === target || (s === target && t === source),
            ),
          `wrongly dropped ${source} → ${target}: ${message}`,
        );
      }

      assert.deepEqual(
        notify,
        Object.keys(players).filter((id) => lottery[id] !== previous[id]),
      );
      for (const id in players) {
        if (!(id in previous)) {
          assert(notify.includes(id), message);
        }
      }
    }
  });

  it("fails fast on impossible games", () => {
    const group = Array.from({ length: 21 }, (_, i) => `G${i}`);
    const others = Array.from({ length: 19 }, (_, i) => `O${i}`);
    const players = makePlayers([group, ...others]);
    assert.throws(() => drawLottery(players), /no valid draw exists/);

    // Same with kept pairs: each release must not pay for sampling, counted
    // as calls to `random`.
    const singles = Array.from({ length: 10 }, (_, i) => `S${i}`);
    const previous = {
      ...drawLottery(makePlayers(singles), {}, { random: seededRandom(0) }),
    };
    const seeded = seededRandom(0);
    let calls = 0;
    const random = () => {
      ++calls;
      return seeded();
    };
    assert.throws(
      () =>
        draw(makePlayers([group.slice(0, 11), ...singles]), previous, {
          random,
        }),
      /no valid draw exists/,
    );
    assert(calls < 1000, `random calls: ${calls}`);
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
      assert(notify.includes(giverToX));
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

  it("inserts a new player into a group", () => {
    for (let seed = 0; seed < 200; ++seed) {
      const random = seededRandom(seed);
      const previous = { ...drawLottery(makePlayers(six), {}, { random }) };
      const players = makePlayers([["A", "N"], "B", "C", "D", "E", "F"]);
      const { lottery, notify } = draw(players, previous, { random });
      assertValid(players, lottery);
      assert.deepEqual(
        notify,
        Object.keys(players).filter((id) => lottery[id] !== previous[id]),
      );
      // N and the giver of a single released pair.
      assert.equal(notify.length, 2, JSON.stringify({ previous, lottery }));
    }
  });

  it("redraws pairs breaking the current rules", () => {
    const players = makePlayers([["A", "B"], "C", "D", "E"]);
    for (const [previous, expectedDropped] of [
      [{ A: "B" }, [["A", "B"]]], // now in the same group
      [{ A: "A" }, [["A", "A"]]],
      [{ C: "D", D: "C" }, [["D", "C"]]],
      [{ A: "C", B: "C" }, [["B", "C"]]],
    ]) {
      const { lottery, dropped } = draw(players, previous, {
        random: seededRandom(0),
      });
      assertValid(players, lottery);
      assert.deepEqual(dropped, expectedDropped);
    }
  });
});

describe("createGlobMatcher", () => {
  const select = (patterns) =>
    ["alice", "alice (junior)", "bob", "tom & jerry"].filter(
      createGlobMatcher(patterns),
    );

  it("selects everyone without patterns", () => {
    assert.equal(select([]).length, 4);
  });

  it("selects names matching any pattern", () => {
    assert.deepEqual(select(["alice*", "bob"]), [
      "alice",
      "alice (junior)",
      "bob",
    ]);
    assert.deepEqual(select(["tom ?"]), []);
    assert.deepEqual(select(["tom & *"]), ["tom & jerry"]);
  });

  it("selects a name from its pattern", () => {
    for (const name of [
      "Alice (junior)",
      "a*b",
      "[x]",
      "!bob",
      "{a,b}",
      "O'Neil",
      "Zoé",
    ]) {
      const pattern = namePattern(name).toLowerCase();
      assert(createGlobMatcher([pattern])(name.toLowerCase()), pattern);
    }
  });

  it("excludes names matching a `!` pattern", () => {
    assert.deepEqual(select(["!alice*"]), ["bob", "tom & jerry"]);
    assert.deepEqual(select(["a*", "!alice"]), ["alice (junior)"]);
  });
});

describe("unmatchedPatterns", () => {
  it("lists include and `!` patterns matching no name", () => {
    assert.deepEqual(
      unmatchedPatterns(["a*", "frnak", "!bob", "!zed"], ["alice", "bob"]),
      ["frnak", "!zed"],
    );
  });
});

describe("compileMailTemplate", () => {
  it("renders fields, text and HTML", () => {
    const render = compileMailTemplate(
      [
        "+++",
        'subject = "{{player.name}}, your gift"',
        'bcc = { name = "Me", address = "me@example.com" }',
        "+++",
        "",
        "Hi {{player.name}}, you give to **{{target.name}}**.",
      ].join("\n"),
    );
    assert.deepEqual(
      render({ player: { name: "Tom & Jerry" }, target: { name: "<b>A</b>" } }),
      {
        subject: "Tom & Jerry, your gift",
        bcc: { name: "Me", address: "me@example.com" },
        text: "Hi Tom & Jerry, you give to **<b>A</b>**.",
        html: "<p>Hi Tom &amp; Jerry, you give to <strong>&lt;b&gt;A&lt;/b&gt;</strong>.</p>\n",
      },
    );
  });

  it("rejects missing fields in the front matter and the body", () => {
    const context = { player: { name: "A" } };
    assert.throws(
      () =>
        compileMailTemplate('+++\nsubject = "{{player.nmae}}"\n+++\n')(context),
      /"nmae" not defined/,
    );
    assert.throws(
      () => compileMailTemplate("{{player.nmae}}")(context),
      /"nmae" not defined/,
    );
  });

  it("passes non-string fields unchanged", () => {
    const { date } = compileMailTemplate("+++\ndate = 2026-12-24\n+++\n")({});
    assert(date instanceof Date);
    assert.equal(date.toISOString(), "2026-12-24");
  });

  it("accepts a body without front matter", () => {
    assert.equal(compileMailTemplate("Hi\n+++\n")({}).text, "Hi\n+++\n");
    assert.equal(compileMailTemplate("+++ Hi\n")({}).text, "+++ Hi\n");
  });

  it("rejects an unclosed front matter", () => {
    assert.throws(() => compileMailTemplate('+++\nsubject = "a"\n'), /\+\+\+/);
  });
});

describe("shellQuote", () => {
  it("quotes for a POSIX shell", () => {
    assert.equal(shellQuote("O'Neil $x"), `'O'\\''Neil $x'`);
    assert.equal(shellQuote("games/2026"), "games/2026");
    assert.equal(shellQuote(""), "''");
  });
});

describe("compileTextTemplate", () => {
  it("rejects missing fields instead of rendering them empty", () => {
    const render = compileTextTemplate("{{target.nmae}}");
    assert.throws(
      () => render({ target: { name: "A" } }),
      /"nmae" not defined/,
    );
  });

  it("rejects a target before the draw", () => {
    const render = compileTextTemplate("{{target.name}}");
    assert.throws(() => render({ target: undefined }), /"name" not defined/);
  });

  it("accepts missing fields in conditions", () => {
    const render = compileTextTemplate("{{#if target}}{{target.name}}{{/if}}");
    assert.equal(render({ target: undefined }), "");
  });

  it("reports syntax errors when compiling", () => {
    assert.throws(() => compileTextTemplate("{{#if a}}"), /Parse error/);
  });
});

describe("hideTarget", () => {
  const players = makePlayers(["A", "B"]);
  players.A.disambiguation = "junior";
  const hidden = hideTarget(players);

  it("has every field any player has, hidden", () => {
    const render = compileTextTemplate(
      "{{target}} {{target.displayName}} {{target.disambiguation}}",
    );
    assert.equal(render({ target: hidden }), "[target] [target] [target]");
  });

  it("still rejects unknown fields", () => {
    const render = compileTextTemplate("{{target.nmae}}");
    assert.throws(() => render({ target: hidden }), /"nmae" not defined/);
  });
});

describe("examples", () => {
  const read = (file) =>
    readFileSync(new URL(`examples/${file}`, import.meta.url), "utf8");
  const players = parsePlayers(read("players.json5"));
  const all = Object.values(players);

  it("can be drawn", () => {
    assert.deepEqual(unreachablePlayers(players), []);
    assertValid(players, drawLottery(players, {}, { random: seededRandom(0) }));
  });

  it("renders the templates for every player", () => {
    const lottery = drawLottery(players, {}, { random: seededRandom(0) });
    const email = compileMailTemplate(read("email.md"));
    const sms = compileTextTemplate(read("sms.txt"));
    for (const player of all) {
      const context = {
        player,
        players: all,
        target: players[lottery[player.id]],
      };
      const name = context.target.displayName;
      assert(email(context).text.includes(name), name);
      assert(sms(context).includes(name), name);
    }
  });

  it("announces the game before the draw", () => {
    const announce = compileMailTemplate(read("announce.md"));
    const { text } = announce({
      player: all[0],
      players: all,
      target: undefined,
    });
    assert.match(text, /- Grace\n/);
  });
});
