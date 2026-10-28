# Memento Smart Frame Controller

**Memento Controller** is an unofficial desktop app for the **Memento Smart
Frame**, for Windows, macOS and Linux. The official Memento Smart Frame apps
are no longer maintained and the maker's servers are offline; this app brings
the frame back under your control: upload photos, manage albums, tune the
display and set the clock again.

It talks to the frame directly over your home network, with the frame's own
local protocol: no account, no cloud, the firmware is not modified, and nothing
leaves your network. Tested with a Memento Smart Frame running software 6.02;
the 25" and 35" models run the same software.

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

## About the Memento Smart Frame

The Memento Smart Frame was a 4K Wi-Fi digital picture frame made by Memento
Electronics Inc. (Terrebonne, Quebec, Canada), sold as the "World's Most
Advanced 4K Smart Frame".

- Two sizes: 25" (29 x 21 x 2 in) and 35" (39 x 29 x 2 in), in black, silver,
  dark brown, auburn or walnut.
- 3240x2160 display (3:2), up to 3000 photos stored on the frame, and an
  ambient light sensor that dims the screen and turns it off in the dark.
- Android 4.4 inside, controlled over Wi-Fi by the official Memento app for
  iOS, Android, Mac and Windows (`smartframepc.exe`).

What no longer works:

- The website `mementosmartframe.com` and its servers
  (`builds.mementosmartframe.com`, `pictureshare.mementosmartframe.com`) are
  gone; an archived copy of the site is on the
  [Wayback Machine](https://web.archive.org/web/20190103143732/https://mementosmartframe.com/).
- The official apps were pulled from the App Store (iOS `id1074055694`, Mac
  `id1076992143`) and Google Play (`com.Memento.SmartFrame`).
- "Share anywhere" remote uploads went through those servers, and the frame no
  longer gets the time from the internet.

The frame itself keeps working on your network, and Memento Controller does
everything the official apps did locally.

## FAQ

**The official Memento app no longer works. Can I still use my frame?**
Yes. Local control never needed the maker's servers: install Memento
Controller on a computer on the same network and it finds the frame.

**Can I still upload photos to my Memento Smart Frame?**
Yes. Drag JPEG or PNG photos (HEIC where the system supports it) into the
Library; the app prepares each one for the frame's 3240x2160 screen.

**Does it need an account or the internet?**
No. Everything stays on your local network.

**Can it update or brick my frame?**
It has no firmware update control, and the risky settings (Wi-Fi change,
forget network, factory reset) each need a double confirmation.

**My frame shows the wrong time after a restart.**
Its time server is offline. Connect with Memento Controller once after each
restart: it sends the computer's time to the frame.

**Can I use it from my phone?**
There is no phone app, but the [headless LAN server](#headless-lan-server) can
be opened from any phone browser on the same network.

**Where can I find the original firmware or the old Windows app?**
In the [firmware archive](#memento-smart-frame-firmware-archive).

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

## Memento Smart Frame firmware archive

The last Memento Smart Frame firmware packages and the official Windows app are
preserved for the community: see [`firmware/README.md`](firmware/README.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free to use, share and modify for
any noncommercial purpose; commercial use is not allowed. The software comes
as is, without any warranty or liability.

The license covers this project's own code only. The firmware packages and
the official Windows app in the firmware archive belong to their owner.
