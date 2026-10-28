# Memento Smart Frame - Web control app (design)

Date: 2026-10-24
Status: draft for approval

## Intent and why

The Memento Smart Frame is a discontinued Android-based digital photo frame.
The only way to manage it was the official desktop and mobile apps, which no
longer run on the owner's hardware (no Windows), and the maker's online
services (time server, update server) are offline. The frame itself still works
and is reachable on the home LAN.

Goal: a modern, cross-platform **web application** that fully replaces the
original desktop controller, so the owner can manage the frame from any
computer on the network. The frame firmware is NOT modified; the app speaks the
frame's existing LAN protocol, which has been reverse-engineered and verified
live against the real device (frame "Salon", software version 6.02).

A separate, later track - replacing the on-device software with a custom
open-source app (OTA / Amlogic USB Burning Tool) - is explicitly out of scope
here and deferred (see Non-goals).

## Goals

- Full feature parity with the original desktop app:
  - Discover the frame on the LAN (auto) with manual IP entry as a fallback.
  - Read and edit all settings (image adjustments, display, scheduling).
  - Upload photos from any computer; delete photos; browse what is on the frame
    (thumbnails); set the currently displayed photo; next/previous.
  - Manage albums (create, rename, delete, order, assign photos).
  - Day/night ("Evening") mode, away schedule, power, shuffle, picture duration,
    orientation, time zone, set clock.
  - Risky/network settings (change WiFi credentials, ForgetNetwork, FactoryReset)
    ARE in scope, isolated in an "advanced / danger" area behind a double
    confirmation (owner's decision - full parity with guards; see Decided).
- Upload accepts any common format the owner's devices produce (HEIC, PNG, JPEG,
  large files) and transcodes server-side before sending to the frame
  (owner's decision; see Decided).
- Run on demand: a single cross-platform program the owner launches on a Mac or
  PC on the network; the UI is served to the browser and reachable from any
  device on the LAN while it runs.
- Architected so it can later move to an always-on host (Raspberry Pi / NAS)
  without a rewrite.

## Non-goals

- No firmware modification, rooting, OTA, or custom ROM in this project. The
  OTA/custom-APK path is a separate future track. (Finding on record: the OTA
  trust anchor is a private Memento Electronics key, not the public AOSP
  test key, so signed-OTA/USB sideload is closed; the realistic second-life
  route is the Amlogic USB Burning Tool, pending hardware eFUSE state.)
- No cloud, no account system, no internet dependency. LAN-only.
- Not reimplementing the frame's own time/picture-share cloud endpoints
  (`builds.mementosmartframe.com`, `pictureshare.mementosmartframe.com`): those
  servers are dead and are not needed for local control.

## Anti-goals (what would make this a failure even if it "works")

- Requiring the user to hand-edit IPs, run shell commands, or understand the
  protocol to do everyday tasks (upload a photo, change a setting).
- Corrupting the frame's album/config state through a malformed write. Writes
  must mirror the exact on-wire formats the frame expects.
- Being tied to one computer or one OS, or silently breaking when Node's crypto
  provider changes (see DES constraint).

## Constraints (verified facts)

### Network / topology
- LAN only. Frame reachable by IP (verified: `192.168.0.128`, ARP reachable,
  TCP 2017/2018 listening while idle).
- Auto-discovery is UDP broadcast and may be blocked by host firewalls or, on
  this dev machine, by the many docker bridge interfaces. **Manual IP entry is
  mandatory as a first-class path, not an afterthought.** Discovery, when it
  works, also yields name/version/size/orientation.

### Crypto (recovered, verified live)
- The frame's software version is 6.02. For version >= 5 (`ENCRYPT_VERSION`),
  the command channel payloads are obfuscated and config/album blobs are
  encrypted. The app MUST implement:
  - **"FastEncrypt"** (command channel `sData`, config): single **DES-CBC**,
    key `M3m3nt0 ` (8 bytes, note trailing space), IV `UHDFram3` (8 bytes),
    plaintext encoded as **UTF-16LE**, output **base64**.
  - **"Encrypt"** (album files on the wire, UDP discovery reply): **AES-256-CBC**
    via PBKDF2 (`Rfc2898DeriveBytes`), password `otnemeM`, salt bytes
    `{101,109,97,114,102,116,114,97,109,83}` ("emarftramS"), key 32 bytes, IV 16
    bytes, base64 output.
- **DES constraint:** OpenSSL 3 (Node 24) drops single-DES from the default
  provider (`error: digital envelope routines::unsupported`). The app MUST NOT
  depend on `--openssl-legacy-provider`. Decision: ship a small **pure-JS DES**
  implementation for FastEncrypt/FastDecrypt so the app is portable and
  flag-free. AES-256-CBC stays on native `crypto` (still supported).

### Frame limits (from decompiled source)
- Images stored under `/sdcard/Photos/`, re-encoded to `.jpg` on device;
  thumbnails `<name>.thumb.png`, 256x170, generated on device.
- Max 67 albums, 3000 images, filename length 64. Three reserved album names:
  `Photos_$%^&(*@#!`, `Evening_$%^&(*@#!`, `Remote_$%^&(*@#!`.
- Frame native image canvas 3240x2160 (25").

## The protocol (reverse-engineered, the heart of the build)

Four fixed ports on the frame:

| Port | Proto | Role |
|------|-------|------|
| 2015 | UDP | Discovery request listener (frame side) |
| 2016 | UDP | Discovery reply target (frame sends reply here, to the requester's IP) |
| 2017 | TCP | Command/control channel |
| 2018 | TCP | File transfer channel |

### Discovery (UDP)
- Send a broadcast to `:2015` with an ASCII payload whose first `|`-field starts
  with `MEMENTO_SMARTFRAME`. Send **exactly 2 fields** (e.g.
  `MEMENTO_SMARTFRAME|MementoWeb`) to get a **plaintext** reply; >= 3 fields makes
  the frame AES-encrypt the reply.
- The frame replies to the requester IP on the fixed port **2016** (not the
  source port), payload `MEMENTO_SMARTFRAME|<json>|<EOF>`. JSON fields include:
  `name`, `utf8_name`, `softver`, `hardver`, `size`, `orientation`, `ip`, `mac`,
  `IsConnected`, `guid`, `hasInternet`, ...
- The frame's listener is bound to `255.255.255.255:2015` (ReceiveBroadcastThread),
  so only the **limited broadcast** reaches it: a subnet broadcast
  (`192.168.0.255`) or a unicast probe is never answered (verified live).
- The reply comes from an ephemeral source port, so a host firewall sees it as
  new inbound traffic: with ufw's default DROP it is discarded until UDP 2016 is
  allowed from the LAN (`ufw allow proto udp from 192.168.0.0/24 to any port 2016`).
- Over Wi-Fi the frame answered ~40% of probes, with misses in runs of a few
  seconds: re-send every 400 ms over a 5 s window, settling 800 ms after the
  first answer (10/10 scans found the frame, typically in 0.8-2.5 s).
- Implementation note: bind a UDP socket to 2016 to catch the reply.

### Command channel (TCP 2017)
- Frame is the server; the app connects. Messages are **ASCII**, terminated by
  the literal `<EOF>`. One message:

  ```
  <ClrTypeName>|<fastJSON>|<commandId>|<EOF>
  ```

- The frame resolves `<ClrTypeName>` with `Type.GetType` inside `CadreAndroid`
  and deserializes `<fastJSON>` into it (fastJSON library). Three command types:
  - `Cadre.CommandChangeSetup` - fields `m_Action` (enum), `sData` (string).
  - `Cadre.CommandControlFlow` - fields `m_Action`, `m_SourceFileName`,
    `m_UpdateUrl`, `m_UpdateMd5`, `m_Data`, `m_Filenames` (list).
  - `Cadre.CommandControlTransferFile` - fields `m_Action`,
    `m_DestinationFileName`, `m_SourceFileName`, `m_FileInfoJSON`, `m_Data`,
    `m_FileSize`.
- **fastJSON wire rules (verified):** member names are the raw field names
  (`m_Action`, `sData`, ...); enums may be sent as their **name string**
  (`"GetConfig"`; `Enum.Parse(..., ignoreCase)`); no `$type` marker is needed
  since the frame passes the concrete type. The frame echoes a `...Done` action
  back in the same shape.
- For version >= 5, string payloads (`sData`, `m_Data`) are FastEncrypt(DES)
  base64 of an inner JSON. For a request that carries no input (e.g. GetConfig),
  an empty `sData` is accepted.

Representative actions (full lists in the decompiled enums):

- `CommandChangeSetup`: `GetConfig`/`SendConfig`, `GetCurrentAlbum`/
  `SendCurrentAlbum`, `SendTime`, `ChangeBrightness`, `ChangeCalibration`,
  `ChangeEvening`, `ChangePower`, `ChangeShuffle`, `ChangePictureDuration`,
  `ChangeThreshold`, `ChangeContrast`, `ChangeExposure`, `ChangeSaturation`,
  `ChangeTimeZone`, `ChangeOrientation`, `ChangeTemperature`, `GetFrameTime`.
  Each inner payload is a one-key JSON object, e.g.
  `{"Contrast":"10"}`, `{"PortraitMode":"true"}`, `{"DateTime":"<...>"}`,
  `{"TimeZone":"..."}`, `{"PictureDuration":"60"}`. Values are strings.
- `CommandControlFlow`: `NextFrame`, `PreviousFrame`, `DisplayImage`
  (`srcfilename`), `DeleteImage` (`filenames` list), `GetCurrentImageName`,
  `Beacon`, `ForgetNetwork`, `FactoryReset`, `Disconnect`, `TriggerUpdate`
  (`url`,`md5` - deferred, keep behind a guard).
- `CommandControlTransferFile`: `WriteFile` (upload a photo), `ReadFile`,
  `GetThumbnailsList`, `GetThumbnails`, `GetAlbums`, `SendAlbums`. These drive
  the file channel below. The inner JSON carries `srcfilename`, `dstfilename`,
  `filesize`, and for uploads an `info` object (e.g. `{"orientation":90}`).

### File channel (TCP 2018)
- A second TCP connection. **Raw byte stream, no framing**: exactly `filesize`
  bytes flow for the file named in the matching 2017 command.
- **One persistent 2018 socket per session** (verified live, sw 6.02): the frame
  transfers only over the first file socket it accepted in the session, so it
  is opened before any transfer command and never half-closed.
- Handshake: `<Action>` -> `<Action>Started` (or `...Failed`), whose real size
  and file name are only in the DES-encrypted `m_Data` JSON
  (`{"dstfilename","filesize"}`; `m_FileSize` is always 0) -> bytes on 2018 ->
  client sends `<Action>Ended` -> `<Action>Succeeded`/`...Failed`. For
  downloads the frame starts streaming before its `Started` reply. For uploads
  `...Ended` must repeat `m_DestinationFileName` and `m_FileSize`; the frame
  holds its reply until the bytes land (and the photo is processed).
- The frame closes a controller session after ~20 s without any command.
- Single controller: while a session is open the frame does not accept() new
  2017/2018 connections; they wait in the kernel backlog and are accepted in
  order when the session ends. A client that gives up on a queued socket leaves
  a dead entry the frame later adopts (2017: held ~20 s; 2018: becomes the next
  session's file socket, so its transfers go nowhere). Wait for the first 2017
  reply before opening 2018, and never abandon a queued socket early.
- The frame pushes `SendCurrentImageName` (its own message id, never ours) on
  every slideshow change, even mid-request; it is not a reply.
- Firmware bug (sw 6.02): on downloads larger than one 256 KB chunk the frame
  can miscount its own sends; its transfer flag then stays set and the
  `<Action>Ended` handler (and that socket's command processing) blocks until
  the 60 s transfer watchdog. `Disconnect` is not blocked and resets the flag,
  so bulk `ReadFile` downloads use one session per file ended by `Disconnect`.
  Thumbnails, the list and albums fit in one chunk and are unaffected.
- Upload (`WriteFile`): app -> frame. Frame writes to `/sdcard/Photos/<name>`
  (lowercased), validates size, re-encodes, builds thumbnail, then displays it.
- Thumbnail browse: `GetThumbnailsList` returns a UTF-8 list file, a
  `Memento Version <v>` header then one `<name>.thumb.png|<md5>` line per photo;
  `GetThumbnails` (photo name in `m_DestinationFileName`) pulls one `.thumb.png`.
  Albums: `GetAlbums`/`SendAlbums` transfer `AlbumData.json`, an AES blob whose
  plaintext is UTF-16LE.

### Data schemas (verified)
- **Config** (`GetConfig`/`SendConfig`): a flat JSON object. Keys include
  `Name, DisplayOn, IsAway, NightModeOn, ShuffleOn, PortraitMode, DisplayTime,
  LightSensor, Brightness, BrightnessOffset{Standard,Dark,Darker,Bright,
  Brighter,Vivid}, OffThresholdOffset, CalibrationTableName, ContrastOffset,
  ExposureOffset, SaturationOffset, TemperatureOffset, AwayDay, AwayOffTime,
  AwayOnTime, AwayEnable, SoftwareVersion, HardwareVersion, ScreenSize, Width,
  Height, Orientation, WiFiSSID, WiFiPSWD, TimeZoneName, SideBars, SideBarsColor,
  GUID`. Booleans are JSON booleans; offsets are ints; `DisplayTime` is seconds.
- **Albums** (`AlbumData.json`, AES-encrypted on disk/wire): a single object
  with index-paired keys `AlbumName_<i>` (string) and `ImageName_<i>` (array of
  filenames). Reserved albums as above.
- **Current album** (`CurrentAlbum.json`, AES-encrypted): object with current
  album name + current image.

## Architecture

Two processes, one launch:

1. **Backend (Node.js)** - the "frame driver":
   - A `MementoClient` module that owns the protocol: UDP discovery, a 2017
     command connection (request/response by `commandId`, `<EOF>` framing), a
     2018 file-transfer helper, and the crypto (pure-JS DES + native AES).
   - Translates between the frame protocol and a clean local HTTP/JSON + file
     API for the browser. Streams uploads to 2018; exposes thumbnails.
   - Serves the built React UI as static files. Binds `0.0.0.0` so any LAN
     device can reach it; prints the URL on launch.
   - Stateless about the frame beyond a short-lived connection + cache of the
     last config/album/thumbnail list.
2. **Frontend (React + Vite)** - the UI:
   - Screens: Connect/Discover, Library (thumbnail grid, upload via drag-drop,
     delete, set-current, next/prev), Albums (CRUD + ordering + assignment),
     Image settings (sliders: brightness/contrast/exposure/saturation/
     temperature/threshold, calibration table), Display & schedule (power,
     shuffle, duration, orientation, day/night, away schedule), Clock/time zone,
     Frame info.
   - Talks only to the local backend over HTTP/JSON (+ WebSocket or SSE for
     live status/transfer progress). Never speaks the frame protocol directly
     (browsers cannot do raw TCP/UDP).

Packaging: an Electron desktop app (Windows installer, macOS dmg, Linux
AppImage) that runs the same backend in its main process, bound to loopback,
and shows the UI in its window. `npm run serve` still runs the backend alone on
`0.0.0.0` for LAN or always-on use; both share one server module.

### Reliability notes baked into the design
- Every frame write is mirror-exact to the recovered format and verified with a
  read-back where the protocol allows (e.g. re-GetConfig after SendConfig).
- The frame accepts one controller connection at a time; the backend serializes
  access and surfaces "busy/transferring" state to the UI.
- Discovery failure is a normal path: UI falls back to manual IP, and a
  successful manual connect is remembered.

## What is decided vs left to the builder

Decided (my calls, per the brainstorm):
- Node backend + React/Vite frontend; local HTTP/JSON API between them.
- Pure-JS DES (no `--openssl-legacy-provider`); native AES-256-CBC.
- On-demand launch, LAN-bound, architected for later always-on.
- Full parity scope; OTA/custom-ROM deferred and guarded.
- **Settings writes use the granular `Change*` actions**, one setting at a time,
  not a whole-object `SendConfig` round-trip. This avoids clobbering fields the
  UI did not touch (the "malformed config write" anti-goal). `GetConfig` is used
  to load current state; `SendConfig` is reserved for an explicit bulk restore.
- **Album/current-image consistency on upload/delete is the frame's job, not the
  app's.** Verified in the decompiled source: `DeleteImage` removes each file
  then the frame calls `ForceSaveAlbumsData`/`ForceSaveCurrentAlbumData`;
  `WriteFile` -> `AddImage` adds to the current album and displays it. So the
  Library screen (upload/delete/display) is a thin pass-through. The app only
  does a read-modify-write of the AES album blob (`GetAlbums`/`SendAlbums`) for
  explicit album management - create/rename/delete-album, reorder, assign - and
  must preserve the three reserved albums untouched.
- **Connection lifecycle:** the backend holds at most one controller connection
  to the frame and serializes all access behind it. On connect it is prepared to
  send `Disconnect` first to clear a stale session; on an abrupt client loss
  (browser close / crash mid-transfer) it closes its frame socket and an idle
  watchdog lets the frame free its side. The UI always shows live connection /
  transfer state and offers a manual reconnect. Exact frame wedge/recovery
  timing is verified live during the build (TDD).
- **Upload policy (owner's decision): accept-all + server-side transcode.** The
  backend accepts HEIC, PNG, JPEG and oversized files; it transcodes to JPEG,
  downsizes to the frame canvas (3240x2160), and applies EXIF orientation before
  sending over port 2018. This adds an image-processing dependency (libvips via
  `sharp`, with HEIC/HEIF support - verify the HEIC codec is available on the
  host at build time). This is the whole point of "upload from any computer".
- **Risky/network settings (owner's decision): include, behind guards.** WiFi
  credential change, `ForgetNetwork`, and `FactoryReset` are exposed but kept in
  a separate "advanced / danger" section with explicit double confirmation and
  clear warnings (WiFi/ForgetNetwork can sever the very link the app uses;
  FactoryReset is irreversible). `TriggerUpdate` stays OUT of the UI entirely
  (OTA is deferred), guarded off by default at the protocol layer.
- **Launch:** `npm start` (Node pre-installed) is acceptable for this owner, who
  is technically comfortable. Everyday tasks (upload, settings, albums) are all
  in the browser and never require a shell - this satisfies the anti-goal, which
  is about everyday use, not the one-time launch. A packaged/double-click
  launcher can come later if an always-on host is chosen.

Left to the builder (sensible defaults, settle during implementation):
- Exact HTTP route shapes and whether live progress uses WebSocket vs SSE.
- UI component library / styling (should feel modern; builder's choice within a
  clean, photo-centric layout).
- How thumbnails are cached/served and the library grid's paging.
- Exact album top-level envelope confirmation by pulling the live file during
  TDD (shape is known; verify against the real frame).
- Test strategy: a protocol-level integration test against the live frame for
  read paths (GetConfig/GetFrameTime/GetThumbnailsList) and a guarded,
  opt-in test for write paths.

## Risks / open questions
- Auto-discovery may never work on some hosts; mitigated by manual IP (accepted).
- Write-path formatting bugs could disturb album/config state; mitigated by
  read-back verification and by testing destructive actions last, opt-in.
- Single-controller constraint on the frame; mitigated by serialized access.
- `TriggerUpdate` exists on the same channel; keep it behind an explicit,
  off-by-default guard so the control UI cannot fire a flash by accident.

## Verified PoC (throwaway, already built)
`poc/` contains three disposable scripts that proved the protocol live:
`discover.js` (UDP), `get-config.js` (TCP 2017 GetConfig + DES decode),
`debug-decrypt.js` (crypto diagnosis). They are not the app; the app is a fresh
codebase. The PoC confirmed: command channel, fastJSON format, DES crypto, and
config parsing all work against frame "Salon" (sw 6.02).
