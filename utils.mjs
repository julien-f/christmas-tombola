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

// Uniform sampling is tried first so that every valid draw is equally
// likely; the bounded search handles heavily constrained games.
const MAX_SAMPLING_TRIES = 1e4;
const MAX_SEARCH_STEPS = 1e6;

// Draws a target for every player which has none in `lottery`.
//
// A player never draws themselves, someone sharing a group with them,
// or the player who draws them.
//
// Returns the complete lottery (`lottery` is left untouched).
export function draw(players, lottery = {}, { random = Math.random } = {}) {
  const result = { __proto__: null, ...lottery };
  const targeted = new Set(Object.values(lottery));
  const sources = [];
  const targets = [];
  for (const id of Object.keys(players)) {
    if (!Object.hasOwn(lottery, id)) {
      sources.push(id);
    }
    if (!targeted.has(id)) {
      targets.push(id);
    }
  }

  const canDraw = (source, target) =>
    !players[source].excluded.has(target) && result[target] !== source;

  if (
    !sampleAssignment(sources, targets, result, canDraw, random) &&
    !searchAssignment(sources, targets, result, canDraw, random)
  ) {
    throw new Error("no valid draw exists");
  }

  return result;
}

function sampleAssignment(sources, targets, result, canDraw, random) {
  const shuffled = targets.slice();
  for (let i = 0; i < MAX_SAMPLING_TRIES; ++i) {
    shuffleArray(shuffled, random);
    sources.forEach((source, j) => {
      result[source] = shuffled[j];
    });
    if (sources.every((source) => canDraw(source, result[source]))) {
      return true;
    }
    for (const source of sources) {
      delete result[source];
    }
  }
  return false;
}

// Depth-first search, assigning first the source with the fewest
// candidates.
function searchAssignment(sources, targets, result, canDraw, random) {
  if (!hasMatching(sources, targets, canDraw)) {
    return false;
  }

  const remaining = new Set(sources);
  const free = new Set(targets);
  let steps = 0;

  const search = () => {
    if (remaining.size === 0) {
      return true;
    }

    let source, candidates;
    for (const s of remaining) {
      const c = [...free].filter((t) => canDraw(s, t));
      if (candidates === undefined || c.length < candidates.length) {
        source = s;
        candidates = c;
      }
    }

    remaining.delete(source);
    shuffleArray(candidates, random);
    for (const target of candidates) {
      if (++steps > MAX_SEARCH_STEPS) {
        throw new Error("no valid draw found (search limit reached)");
      }
      result[source] = target;
      free.delete(target);
      if (search()) {
        return true;
      }
      free.add(target);
      delete result[source];
    }
    remaining.add(source);
    return false;
  };

  return search();
}

// Whether each source can get a distinct target, ignoring reciprocity
// (Kuhn's augmenting paths): rules out impossible games before the
// exponential search.
function hasMatching(sources, targets, canDraw) {
  const owner = new Map();
  const augment = (source, seen) => {
    for (const target of targets) {
      if (canDraw(source, target) && !seen.has(target)) {
        seen.add(target);
        if (!owner.has(target) || augment(owner.get(target), seen)) {
          owner.set(target, source);
          return true;
        }
      }
    }
    return false;
  };
  return sources.every((source) => augment(source, new Set()));
}

// -------------------------------------------------------------------

export const noop = Function.prototype;

// -------------------------------------------------------------------

// Players can be nested in groups (arrays): a player cannot draw anyone
// in any group containing them, at any depth.
export function parsePlayers(json) {
  const players = { __proto__: null };
  const playerGroups = new Map();

  const visit = (entry, groups) => {
    if (Array.isArray(entry)) {
      const subGroups = [...groups, []];
      entry.forEach((item) => visit(item, subGroups));
      return;
    }

    if (entry.participate === false) {
      return;
    }

    entry.displayName = entry.disambiguation
      ? `${entry.name} (${entry.disambiguation})`
      : entry.name;

    const id = String(entry.id ?? entry.displayName);
    entry.id = id;
    if (id in players) {
      throw new Error("duplicate player id: " + id);
    }
    players[id] = entry;

    if (entry.email === undefined && entry.phone === undefined) {
      console.warn("WARNING: player %s has neither email or phone defined", id);
    }

    groups.forEach((group) => group.push(id));
    playerGroups.set(entry, groups);
  };
  JSON5.parse(String(json)).forEach((entry) => visit(entry, []));

  for (const [player, groups] of playerGroups) {
    Object.defineProperty(player, "excluded", {
      value: new Set([player.id, ...groups.flat()]),
    });
  }

  return players;
}

// -------------------------------------------------------------------

// Fisher-Yates shuffle.
export function shuffleArray(array, random = Math.random) {
  for (let n = array.length; n > 1;) {
    const i = Math.floor(random() * n--);
    [array[n], array[i]] = [array[i], array[n]];
  }
}
