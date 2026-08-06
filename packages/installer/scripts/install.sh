#!/bin/sh
# PAW installer (macOS / Linux)
#
# Downloads the paw executable to ~/.paw/bin and puts it on PATH by invoking the
# binary's own `paw-setup path` (which appends an idempotent marker block to the
# detected shell profile). No sudo required.
#
# Usage:  curl -fsSL https://<host>/install.sh | sh
#         PAW_VERSION=v1.0.0 curl -fsSL https://<host>/install.sh | sh
set -eu

version="${PAW_VERSION:-latest}"
bin_dir="${HOME}/.paw/bin"
target="${bin_dir}/paw-setup"

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux)  os=linux ;;
  *) echo "paw: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "paw: unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

url="https://github.com/typeir/paw/releases/download/${version}/paw-setup-${os}-${arch}"

mkdir -p "$bin_dir"
echo "Downloading ${url}"
curl -fsSL "$url" -o "$target"
chmod +x "$target"

# Activate PATH through the binary itself (idempotent profile append).
"$target" path --bin="$bin_dir"
echo "Installed paw to ${bin_dir}. Restart your shell or: source your profile."
