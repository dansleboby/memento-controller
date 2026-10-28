# Firmware archive

Preservation copies of the last known Memento Smart Frame software, kept so
owners can still find them now that the maker's download servers are offline.
The files themselves are too large for git: they are published as release
assets (and on the Internet Archive), and only this page and `SHA256SUMS` live
in the repository.

| File | What it is | Size | Download |
|------|------------|------|----------|
| `Memento_25.zip` | System update package for the 25" frame | 123 MB | _link after publication_ |
| `Memento_35.zip` | System update package for the 35" frame | 123 MB | _link after publication_ |
| `smartframepc.exe` | Official Windows app installer | 17 MB | [Wayback Machine, 2019-04-07](https://web.archive.org/web/20190407070756/https://builds.mementosmartframe.com/latest/smartframepc.exe) |
| `memento-35-manual-update-procedure.pdf` | Official USB update procedure (35") | 0.4 MB | _link after publication_ |

Verify a download with `sha256sum -c SHA256SUMS`.

## System update packages

- These are the original packages, as the maker distributed them: Android
  update zips still carrying their whole-file signature (`signed by SignApk`),
  1034 entries each, intact. They were recovered from copies shared on owner
  forums; the maker's own Google Drive folder (linked from the PDF) is no
  longer a reliable source.
- Build `KOT49H.20170727` (Android 4.4.2, board `n301`), built 2017-07-27,
  signed with test keys. The two packages differ only in their
  hardware-specific files (boot image, recovery, display library,
  `CadreHardware.json`).
- The official USB procedure also copies an `update.txt` next to the zip; that
  file has not been found, so its expected content is unknown.
- The frame app bundled in the system image (`system/app/Cadre.apk`) dates from
  2015-11-17; frames in the field may run a newer app (the tested frame reports
  software 6.02).
- Flashing firmware can brick a frame. These copies are kept for reference and
  recovery work, not as a recommended upgrade.

## Windows app

`smartframepc.exe` is byte-for-byte identical to the copy the Wayback Machine
captured from `builds.mementosmartframe.com/latest/` on 2019-04-07 (same
SHA-256).
