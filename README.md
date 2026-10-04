# UNO

> A real-time multiplayer UNO-style card game with rooms and optional bots.

## Overview

A Node.js server coordinates game state and player actions over Socket.IO. The project documents classic action cards, room play, bot opponents, and browser-based gameplay.

## What’s in this repo

- Multiplayer rooms and real-time game updates
- Skip, reverse, draw, wild, and challenge rules
- Optional bot players, themes, and in-game interactions

## Stack

Node.js, Express, Socket.IO, and browser JavaScript; the server code is in `server/`.

## Getting started

1. Install Node.js, then run `npm install` at the repository root.
2. Start the server with `npm start` and open the local address it prints.
3. For a public deployment, review the environment and security guidance in the existing documentation.

## Notes

This is an independently built UNO-style game, not an official Mattel product. Verify rules and room behavior before exposing a public server.
