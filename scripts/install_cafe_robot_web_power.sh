#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -- "$0" "$@"
fi

robot_user="${SUDO_USER:-}"
if [[ -z "${robot_user}" || "${robot_user}" == "root" ]] || ! getent passwd "${robot_user}" >/dev/null; then
  echo "Run this script with sudo from the account that owns robot.service." >&2
  exit 1
fi

sudoers_tmp="$(mktemp)"
trap 'rm -f "${sudoers_tmp}"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/bin/systemctl reboot, /usr/bin/systemctl poweroff\n' \
  "${robot_user}" >"${sudoers_tmp}"

visudo -cf "${sudoers_tmp}"
install -o root -g root -m 0440 "${sudoers_tmp}" \
  /etc/sudoers.d/cafe-robot-web-power
visudo -cf /etc/sudoers.d/cafe-robot-web-power

echo "Installed restricted web power controls for ${robot_user}."
