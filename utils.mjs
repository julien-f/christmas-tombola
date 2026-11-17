import { marked } from "marked";
import frontMatter from "front-matter";
import handlebars from "handlebars";
import JSON5 from "json5";
import { matchesGlob } from "node:path";
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

// Strict: a missing field throws instead of rendering empty. Parsed now
// so that syntax errors show up before the first render.
const compile = (source, options) =>
  handlebars.compile(handlebars.parse(source), { strict: true, ...options });

export const compileTextTemplate = (source) =>
  compile(source, { noEscape: true });

// Compiles a mail template: a Markdown body and a front matter of
// Nodemailer fields (subject, etc.), all Handlebars templates.
//
// Returns a function which, given a context, returns Nodemailer data
// with `text` and `html` parts.
export function compileMailTemplate(source) {
  const { attributes, body } = frontMatter(source);

  const fields = mapLeaves(attributes, (value) =>
    typeof value === "string" ? compileTextTemplate(value) : value,
  );
  const text = compileTextTemplate(body);
  // Escaped values so that names cannot inject HTML.
  const html = compile(body);

  return (context) => ({
    ...mapLeaves(fields, (value) =>
      typeof value === "function" ? value(context) : value,
    ),
    text: text(context),
    html: marked.parse(html(context)),
  });
}

// -------------------------------------------------------------------

// Matches entries against any of `patterns` (all if none), except those
// matching a `!` pattern.
export function createGlobMatcher(patterns) {
  const include = patterns.filter((pattern) => pattern[0] !== "!");
  const exclude = patterns
    .filter((pattern) => pattern[0] === "!")
    .map((pattern) => pattern.slice(1));
  const matches = (entry, list) =>
    list.some((pattern) => matchesGlob(entry, pattern));

  return (entry) =>
    !matches(entry, exclude) &&
    (include.length === 0 || matches(entry, include));
}

// A pattern selecting `name`. Other characters become `?`: escaping glob
// syntax (`!`, braces…) does not work reliably.
export const namePattern = (name) => name.replace(/[^\p{L}\p{N} .'_-]/gu, "?");

// For a POSIX shell.
export const shellQuote = (string) =>
  /^[\w./+=-]+$/.test(string) ? string : `'${string.replaceAll("'", `'\\''`)}'`;

// -------------------------------------------------------------------

// A target for dry runs: every field any player has, so that a typo
// still fails, all "[target]", so that nothing about the real target
// shows.
export function hideTarget(players) {
  const hidden = { toString: () => "[target]" };
  for (const player of Object.values(players)) {
    for (const key of Object.keys(player)) {
      hidden[key] = "[target]";
    }
  }
  return hidden;
}

// -------------------------------------------------------------------

export async function createMailer({ transport: transportConfig, ...config }) {
  const transport = nodemailer.createTransport(transportConfig);

  await transport.verify();

  return async function sendMail(to, data) {
    return transport.sendMail({ ...config, ...data, to });
  };
}

// -------------------------------------------------------------------

// Uniform sampling is tried first so that every valid draw is equally
// likely; the bounded search, not uniform, handles heavily constrained
// games (e.g. a group of a third of the players).
const MAX_SAMPLING_TRIES = 1e4;
const MAX_SEARCH_STEPS = 1e6;

// Completes `previous` (source id → target id) so that every player has
// a target.
//
// A player never draws themselves, someone sharing a group with them,
// or the player who draws them.
//
// Pairs involving someone who no longer plays or breaking the current
// rules (e.g. after regrouping) are dropped; other pairs are kept unless
// the open slots cannot be filled without redrawing some of them.
//
// Returns the lottery, the dropped pairs and the ids of the players
// whose target is new.
export function draw(players, previous = {}, { random = Math.random } = {}) {
  const lottery = { __proto__: null };
  const canDraw = (source, target) =>
    !players[source].excluded.has(target) && lottery[target] !== source;

  const targeted = new Set();
  const dropped = [];
  for (const [source, target] of Object.entries(previous)) {
    if (
      source in players &&
      target in players &&
      !targeted.has(target) &&
      canDraw(source, target)
    ) {
      lottery[source] = target;
      targeted.add(target);
    } else {
      dropped.push([source, target]);
    }
  }

  const ids = Object.keys(players);
  const sources = ids.filter((id) => !(id in lottery));
  const targets = ids.filter((id) => !targeted.has(id));

  // The matching rules out impossible fills before sampling them.
  const fill = () =>
    hasMatching(sources, targets, canDraw) &&
    (sampleAssignment(sources, targets, lottery, canDraw, random) ||
      searchAssignment(sources, targets, lottery, canDraw, random));

  const release = (source) => {
    sources.push(source);
    targets.push(lottery[source]);
    delete lottery[source];
  };
  const releaseAlone = (source) => {
    const target = lottery[source];
    release(source);
    if (fill()) {
      return true;
    }
    sources.pop();
    targets.pop();
    lottery[source] = target;
    return false;
  };

  // If the open slots cannot be filled, release a single existing pair if
  // that suffices (e.g. a new player N and a released A → B give
  // A → N → B), otherwise pairs one at a time until it does.
  const kept = Object.keys(lottery);
  shuffleArray(kept, random);
  if (!fill() && !kept.some(releaseAlone)) {
    do {
      const source = kept.pop();
      if (source === undefined) {
        throw new Error("no valid draw exists");
      }
      release(source);
    } while (!fill());
  }

  // A released pair can be drawn again.
  const notify = ids.filter((id) => lottery[id] !== previous[id]);
  return { lottery, dropped, notify };
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
// candidates and pruning branches without a matching.
function searchAssignment(sources, targets, result, canDraw, random) {
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
      // Checked after the assignment so that its reciprocity counts.
      if (hasMatching([...remaining], [...free], canDraw) && search()) {
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
// (Kuhn's augmenting paths).
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

// Players who would never learn their target.
export const unreachablePlayers = (players) =>
  Object.values(players).filter(
    (player) =>
      player.email === undefined &&
      player.phone === undefined &&
      player.inPerson !== true,
  );

// -------------------------------------------------------------------

// Fisher-Yates shuffle.
export function shuffleArray(array, random = Math.random) {
  for (let n = array.length; n > 1;) {
    const i = Math.floor(random() * n--);
    [array[n], array[i]] = [array[i], array[n]];
  }
}
