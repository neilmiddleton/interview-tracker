# RAFAC Cadet Interview Tracker

A desktop application for Royal Air Force Air Cadets (RAFAC) squadron staff to manage cadet interviews, track progression, and maintain records.

## Features

- **PIN-protected access** — 4-digit PIN lock screen on launch
- **Cadet management** — add cadets with name, rank, and classification
- **Interview records** — log interviews with questions and answers, view and print records
- **Interview templates** — built-in templates (Initial Interview, Annual Review, Promotion Consideration, Classification Assessment) plus custom templates
- **Promotion history** — record rank and classification changes over time
- **Dashboard** — overview of total cadets, interviews this month, upcoming and overdue interviews
- **Notes** — free-text notes per cadet, auto-saved
- **Export / print** — print individual interview records or full cadet reports as PDF
- **Backup & restore** — save and restore the SQLite database

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- npm

## Getting Started

```sh
npm install
npm start
```

The default PIN is `0000`. Change it via Settings once logged in.

## Building

### Windows installer

```sh
npm run build-win
```

Output: `dist/RAFAC Cadet Interview Tracker Setup <version>.exe`

### macOS DMG

```sh
npm run build-mac
```

Output: `dist/RAFAC Cadet Interview Tracker-<version>.dmg`

## Data storage

All data is stored in a SQLite database at the Electron `userData` path:

- **Windows:** `%APPDATA%\RAFAC Cadet Interview Tracker\cadet-interviews.db`
- **macOS:** `~/Library/Application Support/RAFAC Cadet Interview Tracker/cadet-interviews.db`

Use the **Backup** option in Settings to export a copy.

## Tech stack

- [Electron](https://www.electronjs.org/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [GOV.UK Frontend](https://frontend.design-system.service.gov.uk/)
- [electron-builder](https://www.electron.build/)
