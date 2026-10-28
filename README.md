# Memento Controller

An unofficial desktop app (Windows, macOS, Linux) to manage a **Memento Smart
Frame** on your home network, now that the official desktop and mobile apps are
no longer maintained. It speaks the frame's existing local protocol: the
frame's firmware is not modified, and nothing leaves your network.

> Not affiliated with or endorsed by the makers of the Memento Smart Frame.
> "Memento Smart Frame" is a trademark of its owner.

## Features

- **English and French** interface (follows the system, switchable in the header),
  light and dark themes.
- **Connect**: find the frame on the network, or enter its IP address.
- **Library**: browse every photo on the frame, upload new ones (drag and drop,
  JPEG/PNG, HEIC when the system supports it), delete, show a photo right now,
  next/previous.
- **Albums**: create, rename, reorder and delete albums, assign photos.
- **Image**: brightness, contrast, exposure, saturation, color temperature,
  auto-off threshold, calibration table.
- **Display**: power, shuffle, portrait mode, evening mode, time per photo, and
  the away schedule (screen off during chosen hours).
- **Clock**: time zone and clock sync.
- **Info** and a guarded **Advanced** area (change Wi-Fi, forget network,
  factory reset), each behind a double confirmation. There is deliberately no
  firmware update control.

## Install

Download the file for your system from the
[latest release](https://github.com/dansleboby/memento-controller/releases/latest):

| System | File |
|--------|------|
| Windows | `Memento-Controller-<version>-win-x64.exe` (installer) |
| macOS, Apple Silicon | `Memento-Controller-<version>-mac-arm64.dmg` |
| macOS, Intel | `Memento-Controller-<version>-mac-x64.dmg` |
| Linux | `Memento-Controller-<version>-linux-x86_64.AppImage` (`chmod +x`, then run) |

The computer and the frame must be on the same local network.

The builds are not signed with a paid certificate, so the system warns on
first launch:

- **Windows**: SmartScreen says "Windows protected your PC": choose
  *More info*, then *Run anyway*.
- **macOS**: the app is blocked as coming from an unidentified developer. Open
  *System Settings > Privacy & Security* and choose *Open Anyway*, or run
  `xattr -cr "/Applications/Memento Controller.app"` once. Allow the *Local
  Network* prompt, or the frame cannot be found.

## Run from source

Node.js 20.9 or newer.

```sh
npm run setup   # once: installs the app, server/ and web/ dependencies
npm start       # builds the UI, then opens the desktop app
```

On Linux, if Electron aborts with "The SUID sandbox helper binary was found,
but is not configured correctly", run `npm start -- --no-sandbox`.

### Headless LAN server

The same controller can still run without the desktop shell, as a server any
phone or computer on the network can open:

```sh
npm run serve   # builds the UI, then serves it on port 8080
```

It prints the addresses to open, for example `http://192.168.0.10:8080`. Set
`PORT` to use another port.

## Network notes

- The controller connects to the frame on **TCP 2017** (commands) and
  **TCP 2018** (files). The frame accepts one controller at a time: close the
  official app while using this one.
- **Discovery** sends a UDP broadcast to `255.255.255.255:2015`; the frame
  answers on **UDP 2016** of the computer. A host firewall usually drops that
  answer. On Windows and macOS, accept the firewall prompt shown on the first
  scan. Otherwise enter the frame's IP address manually, or allow the answer,
  e.g. with ufw:

  ```sh
  sudo ufw allow proto udp from 192.168.0.0/24 to any port 2016 comment 'Memento discovery'
  ```

- Over Wi-Fi the frame misses some broadcasts, so a scan repeats its request
  for up to 5 seconds.

## Frame behaviors worth knowing

- **The clock**: the frame used to get the time from the maker's server, which
  is offline. After every reboot its clock is unset until an app sends the
  time, and a time zone change can fail until then. The controller sends the
  time on every connection, like the official app did.
- **Photo layout**: the frame composes each upload itself. Photos close to 3:2
  are centre-cropped to fill the 3240x2160 screen; portraits and panoramas are
  shown whole over a blurred, enlarged copy of themselves.
- **Brightness** follows the room's light through an 11-point curve; the
  controls nudge it brighter or darker at the current light level, or reset it.

## How it works

- `electron/`: the desktop shell. It runs the server inside the app on
  `127.0.0.1` only (port 47017, or a free one if taken) and opens the UI in
  its window.
- `server/`: Node/Express API. `server/src/protocol/` implements the frame's
  protocol (UDP discovery, command channel, file channel, encryption).
- `web/`: React/Vite UI, served by the same server.
- `docs/design.md`: the reverse-engineered protocol and the design notes,
  verified against a real frame (software 6.02).
- `poc/`: the small standalone scripts used to first validate the protocol.

## Development

```sh
cd server && npm test   # protocol, routes, mock frame
cd web && npm test      # screens
```

An opt-in integration test reads from a real frame (it only syncs the clock):

```sh
cd server && MEMENTO_LIVE_IP=192.168.0.128 npx vitest run test/live.frame.test.js
```

`npm run dist` packages the app for the current system into `dist/`.

### Releasing

Push a version tag; the `Release` workflow runs the tests, builds the Windows
installer, both macOS disk images and the AppImage on native runners, and
publishes them as a GitHub release named after the tag (the tag sets the
version, so `package.json` does not need a bump):

```sh
git tag v0.2.0 && git push origin v0.2.0
```

Running the workflow by hand (*Actions > Release > Run workflow*) only builds,
and leaves the files as workflow artifacts.

## Firmware archive

The last firmware packages and the official Windows app are preserved for the
community: see [`firmware/README.md`](firmware/README.md).

## License

To be decided before publication.
