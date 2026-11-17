import { marked } from "marked";
import frontMatter from "front-matter";
import handlebars from "handlebars";
import JSON5 from "json5";
import micromatch from "micromatch";
import nodemailer from "nodemailer";

// ===================================================================

// Applies `fn` to every leaf of a JSON-like value.
function mapLeaves(value, fn) {
  if (Array.isArray(value)) {
    return value.map((item) => mapLeaves(item, fn));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapLeaves(item, fn)]),
    );
  }
  return fn(value);
}

// Compiles a Handlebars email template with a front matter.
//
// Returns a function which when executed returns an object which can
// be used directly with Nodemailer.
export function compileMailTemplate(source) {
  const { attributes: mailTemplate = {}, body } = frontMatter(source);

  mailTemplate.markdown = body;

  const compiled = mapLeaves(mailTemplate, (value) =>
    typeof value === "string" ? handlebars.compile(value) : value,
  );

  return (context) =>
    mapLeaves(compiled, (value) =>
      typeof value === "function" ? value(context) : value,
    );
}

// -------------------------------------------------------------------

export function createGlobMatcher(patterns) {
  if (patterns.length === 0) {
    return () => true;
  }

  const noneMustMatch = [];
  const anyMustMatch = [];

  patterns.forEach((pattern) => {
    if (pattern[0] === "!") {
      noneMustMatch.push(micromatch.matcher(pattern.slice(1)));
    } else {
      anyMustMatch.push(micromatch.matcher(pattern));
    }
  });

  const n = noneMustMatch.length;
  const m = anyMustMatch.length;

  return (entry) => {
    for (let i = 0; i < n; ++i) {
      if (noneMustMatch[i](entry)) {
        return false;
      }
    }

    if (m === 0) {
      return true;
    }

    for (let i = 0; i < m; ++i) {
      if (anyMustMatch[i](entry)) {
        return true;
      }
    }

    return false;
  };
}

// -------------------------------------------------------------------

export async function createMailer({ transport: transportConfig, ...config }) {
  const transport = nodemailer.createTransport(transportConfig);

  await transport.verify();

  return async function sendMail(data, noTest = false) {
    data = { ...config, ...data };

    const { markdown } = data;
    if (markdown !== undefined) {
      delete data.markdown;
      data.text = markdown;
      data.html = marked.parse(markdown);
    }

    return noTest && transport.sendMail(data);
  };
}

// -------------------------------------------------------------------

export function draw(_items, lottery = { __proto__: null }) {
  const haveTarget = new Set(Object.keys(lottery));
  const haveBeenAssigned = new Set(Object.values(lottery));

  const todo = [];
  const candidates = [];
  for (const item of Object.values(_items)) {
    if (!haveTarget.has(item.id)) {
      todo.push(item);
    }
    if (!haveBeenAssigned.has(item.id)) {
      candidates.push(item);
    }
  }

  shuffleArray(candidates);

  function drawItem(blacklist) {
    const { length } = candidates;

    for (let i = 0; i < length; ++i) {
      const candidate = candidates[i];

      if (!blacklist.has(candidate.id)) {
        // Remove the selected candidate.
        const newLength = length - 1;
        candidates[i] = candidates[newLength];
        candidates.length = newLength;

        return candidate;
      }
    }

    throw new Error("could not find a suitable candidate");
  }

  while (todo.length) {
    // Sort by ascending blacklist size.
    todo.sort((a, b) => a._blacklist.size - b._blacklist.size);

    // Take the last one.
    const item = todo.pop();

    // The target cannot draw item.
    const target = drawItem(item._blacklist);
    target._blacklist.add(item.id);

    lottery[item.id] = target.id;
  }

  return lottery;
}

// -------------------------------------------------------------------

export const noop = Function.prototype;

// -------------------------------------------------------------------

const _makeBlacklist = (parent = null) => ({
  __proto__: parent,
  _size: 0,

  get size() {
    return parent ? this._size + parent._size : this._size;
  },

  add(id) {
    this[id] = true;
    ++this._size;
  },

  has(id) {
    return id in this;
  },
});

function _parsePlayer(player) {
  if (Array.isArray(player)) {
    return player.forEach(_parsePlayer, {
      __proto__: this,
      blacklist: _makeBlacklist(this.blacklist),
    });
  }

  if (player.participate === false) {
    return;
  }

  Object.defineProperty(player, "_blacklist", {
    value: _makeBlacklist(this.blacklist),
  });
  player.displayName = player.disambiguation
    ? `${player.name} (${player.disambiguation})`
    : player.name;

  let { id } = player;
  if (id === undefined) {
    id = player.displayName;
    player.id = id;
  }

  // Registers the player
  const { players } = this;
  if (id in players) {
    throw new Error("duplicate player id: " + id);
  }
  players[id] = player;

  if (player.email === undefined && player.phone === undefined) {
    console.warn("WARNING: player %s has neither email or phone defined", id);
  }

  if (this.blacklist) {
    // Update the common blacklist if any otherwise just the player one.
    this.blacklist.add(id);
  } else {
    player._blacklist.add(id);
  }
}

export const parsePlayers = (json) => {
  const players = { __proto__: null };

  JSON5.parse(String(json)).forEach(_parsePlayer, {
    blacklist: null,
    players,
  });

  return players;
};

// -------------------------------------------------------------------

// Fisher-Yates shuffle.
// http://bost.ocks.org/mike/shuffle/
export function shuffleArray(array) {
  let n = array.length;
  let i, tmp;

  while (n) {
    i = Math.floor(Math.random() * n--);

    tmp = array[n];
    array[n] = array[i];
    array[i] = tmp;
  }
}
