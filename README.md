# Memento Web Controller

An unofficial web app to manage a **Memento Smart Frame** from any browser on
your home network, now that the official desktop and mobile apps are no longer
maintained. It speaks the frame's existing local protocol: the frame's firmware
is not modified, and nothing leaves your network.

> Not affiliated with or endorsed by the makers of the Memento Smart Frame.
> "Memento Smart Frame" is a trademark of its owner.

## Features

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

## Requirements

- Node.js 20.9 or newer.
- The computer running the controller and the frame on the same local network.

## Quick start

```sh
npm run setup   # once: installs server/ and web/ dependencies
npm start       # builds the UI, then starts the server on port 8080
```

`npm start` prints the addresses to open, for example `http://192.168.0.10:8080`,
reachable from any phone or computer on the same network. Set `PORT` to use
another port.

## Network notes

- The controller connects to the frame on **TCP 2017** (commands) and
  **TCP 2018** (files). The frame accepts one controller at a time: close the
  official app while using this one.
- **Discovery** sends a UDP broadcast to `255.255.255.255:2015`; the frame
  answers on **UDP 2016** of the computer. A host firewall usually drops that
  answer. Either enter the frame's IP address manually, or allow it, e.g. with
  ufw:

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

## Firmware archive

The last firmware packages and the official Windows app are preserved for the
community: see [`firmware/README.md`](firmware/README.md).

## License

To be decided before publication.
