# Usage

##

```
$ tombola draw players.json
```

## Send a mail to all players

```
$ tombola mail --subject 'Tombola' players.json
Hi <%= player.name %>,

Your target has been selected, it's **<%= target.name %>**,

For your information, the following people are playing too:
<% players.forEach(function (player) { %>
- <%= player.name %>
<% }) %>
^D
```
