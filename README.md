# Magnetite

Music, magnetized.

[![Magnetite turns the MacBook camera notch into sound-driven black ferrofluid.](https://magnetite.app/og.png)](https://magnetite.app/)

A free, open-source macOS music player that lives in the MacBook camera notch
and turns real system audio into one continuous reservoir of black ferrofluid.

[See the live demo](https://magnetite.app/) · [Download Magnetite v0.1.1](https://github.com/scryst/magnetite-releases/releases/tag/v0.1.1) · [Source code](https://github.com/scryst/magnetite)

## Install

```sh
curl -fsSL https://magnetite.app/install.sh | sh
```

The installer downloads the latest release from this repository, checks it
against its published SHA-256, verifies the code signature and opens the app.
Run it again to update.

## Verify a manual download

Download the ZIP and matching `.sha256` file from the same release, keep them
in one folder, then run:

```sh
shasum -a 256 -c Magnetite-0.1.1.sha256
```

The result must say `Magnetite-0.1.1.zip: OK`. Official binaries are published
only through this repository's [Releases](https://github.com/scryst/magnetite-releases/releases).

Requires macOS 26 on Apple silicon. The current build is ad-hoc signed, so a
downloaded ZIP needs one approval under System Settings › Privacy & Security ›
Open Anyway. The installer above avoids that step.

## About

This repository holds the official binaries and release notes for
[Magnetite](https://github.com/scryst/magnetite), a personal project by
[scryst](https://github.com/scryst). The source is at
[scryst/magnetite](https://github.com/scryst/magnetite) under the MIT License.
No trackers. No frameworks.

For bugs or product feedback, open an
[issue](https://github.com/scryst/magnetite/issues). Report suspected security
problems privately as described in [SECURITY.md](SECURITY.md).

[Privacy](https://magnetite.app/privacy.html) · [Terms](https://magnetite.app/terms.html)
