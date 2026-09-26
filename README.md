# ssh-github-setup

Generates and configures an SSH key for GitHub, with interactive prompts via
[`@clack/prompts`](https://github.com/bombshell-dev/clack) — the same
library used by `pnpm create` and `bun create`.

## What it does

1. Asks for the email associated with your GitHub account
2. Generates an `ed25519` SSH key (or reuses an existing one)
3. Starts (or reuses) the SSH agent and adds the key to it
4. Copies the public key to the clipboard
5. Opens GitHub's "Add SSH key" page
6. Tests the connection with `ssh -T git@github.com`

## Clipboard support

No external clipboard dependency is required. The script tries, in order:

1. A native tool if available (`wl-copy`, `xclip`, `termux-clipboard-set`, `pbcopy`)
2. The **OSC 52** terminal escape sequence, which asks the terminal emulator
   itself to set the clipboard — no binary, no X11/Wayland server, no
   companion app needed. Supported by most modern terminals (Ghostty,
   Termux's own terminal app, kitty, iTerm2, WezTerm, Windows Terminal).

The public key is always printed as well, so it can be copied manually if
neither method works.

## Requirements

- [Bun](https://bun.sh)
- `openssh` (`ssh`, `ssh-keygen`, `ssh-agent`, `ssh-add`)

## Run directly (no build step)

```bash
git clone https://github.com/emersonbernardini/ssh-github-setup.git
cd ssh-github-setup
bun install
bun run start
```

## Compile to a single binary

```bash
bun install
bun run build
./ssh-github-setup
```

This produces a standalone executable that bundles the Bun runtime — it can
be copied to any machine with the same architecture without Bun installed.

## Download a prebuilt binary

Every tagged release is built automatically for Linux and macOS
(x64 and arm64) via GitHub Actions. Grab the one matching your platform from
the [Releases page](https://github.com/emersonbernardini/ssh-github-setup/releases):

```bash
curl -fsSL https://github.com/emersonbernardini/ssh-github-setup/releases/latest/download/ssh-github-setup-bun-linux-x64 -o ssh-github-setup
chmod +x ssh-github-setup
./ssh-github-setup
```

(swap `bun-linux-x64` for `bun-linux-arm64`, `bun-darwin-x64`, or
`bun-darwin-arm64` depending on your system)

> **Termux (Android) note:** the prebuilt Linux binaries target glibc and
> won't run under Termux, since it uses Android's Bionic libc instead
> (you'll see an error like `Check the interpreter or linker?` or
> `cannot execute binary file`). On Termux, use
> [Run directly](#run-directly-no-build-step) with `bun run start`
> instead — or run the binary inside a glibc-based container (e.g. via
> `proot-distro`), which works fine since it's a real Linux userland.

## License

[MIT](./LICENSE)
