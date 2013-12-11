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
  for id, player of players
    player._candidates = (candidateId for candidateId, candidate of players \
      when candidateId isnt id \
        and candidateId isnt player.lover)

  # For each player, randomly selects a target from its candidates and
  # makes sure this target will not be picked again.
  toCompute = (player for _, player of players)
  while toCompute.length isnt 0
    # Sorts player by decreasing number of candidates.
    toCompute.sort (a, b) ->
      a = a._candidates.length
      b = b._candidates.length

      if a is b then 0 else if a < b then 1 else -1

    player = toCompute.pop()

    n = player._candidates.length
    throw "#{player.name} does not have a candidate" if n is 0

    # Randomly selects a target amongst candidates.
    target = player.target = player._candidates[random n]
    delete player._candidates

    # Remove this target from other players candidates.
    for player in toCompute
      i = player._candidates.indexOf target
      player._candidates.splice i, 1 if i isnt -1

  # Prints the result in JSON.
  console.log JSON.stringify players
