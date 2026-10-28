# Firmware archive

Preservation copies of the last known Memento Smart Frame software, kept so
owners can still find them now that the maker's download servers are offline.
The files themselves are too large for git: they are published as release
assets (and on the Internet Archive), and only this page and `SHA256SUMS` live
in the repository.

| File | What it is | Size | Download |
|------|------------|------|----------|
| `Memento_25-extracted-20170727.zip` | System update for the 25" frame | 123 MB | _link after publication_ |
| `Memento_35-extracted-20170727.zip` | System update for the 35" frame | 123 MB | _link after publication_ |
| `smartframepc.exe` | Official Windows app installer | 17 MB | [Wayback Machine, 2019-04-07](https://web.archive.org/web/20190407070756/https://builds.mementosmartframe.com/latest/smartframepc.exe) |
| `memento-35-manual-update-procedure.pdf` | Official USB update procedure (35") | 0.4 MB | _link after publication_ |

Verify a download with `sha256sum -c SHA256SUMS`.

## System updates

- Build `KOT49H.20170727` (Android 4.4.2, board `n301`), built 2017-07-27,
  signed with test keys. The two packages differ only in their
  hardware-specific files (boot image, recovery, display library,
  `CadreHardware.json`).
- **These are not the original files.** The maker distributed `Memento_35.zip`
  plus an `update.txt` through a Google Drive folder (see the PDF); neither
  original survives here. These archives were rebuilt from the extracted
  package contents, with the original layout (`META-INF/`, `system/`,
  `recovery/`, images). The whole-file signature of the original package could
  not be preserved, so the frame's USB update may refuse them as they are.
- The frame app bundled in the system image (`system/app/Cadre.apk`) dates from
  2015-11-17; frames in the field may run a newer app (the tested frame reports
  software 6.02).
- Flashing firmware can brick a frame. These copies are kept for reference and
  recovery work, not as a recommended upgrade.

## Windows app

`smartframepc.exe` is byte-for-byte identical to the copy the Wayback Machine
captured from `builds.mementosmartframe.com/latest/` on 2019-04-07 (same
SHA-256).
