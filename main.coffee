# File system.
$fs = require 'fs'

# Paths handling.
$path = require 'path'

#---------------------------------------------------------------------

# Configuration handling.
$nconf = require 'nconf'

#=====================================================================

# Returns a random integer beetween 0 and n - 1.
random = (n) -> Math.floor Math.random() * n

#=====================================================================

# Main
do ->
  # Options parsing.
  $nconf.argv {
    players: {
      describe: 'File containing the players of this tombola'
      demand: true
    }
  }

  # Handles JavaScript, JSON and CoffeeScript files.
  #
  # We use an absolute path to make sure relative paths are resolved
  # from the working directory and not from where this file is.
  players = require $path.resolve $nconf.get 'players'

  # For each player, computes a list of candidates.
  toCompute = for id, player of players
    candidates = (candidateId for candidateId, candidate of players \
      when candidateId isnt id \
        and candidateId isnt player.lover)

    {id, player, candidates}

  # For each player, randomly selects a target from its candidates and
  # makes sure this target will not be picked again.
  while toCompute.length isnt 0
    # Sorts player by decreasing number of candidates.
    toCompute.sort (a, b) ->
      a = a.candidates.length
      b = b.candidates.length

      if a is b then 0 else if a < b then 1 else -1

    {id, player, candidates} = toCompute.pop()

    n = candidates.length
    throw "#{id} does not have a candidate" if n is 0

    # Randomly selects a target amongst candidates.
    target = player.target = candidates[random n]

    # Remove this target from other players candidates.
    for {id_, candidates} in toCompute
      i = candidates.indexOf target
      candidates.splice i, 1 if i isnt -1

      # And we don't want to have player <-> target.
      if id_ is target
        i = candidates.indexOf id
        candidates.splice i, 1 if i isnt -1

  # Prints the result in JSON.
  console.log JSON.stringify players
