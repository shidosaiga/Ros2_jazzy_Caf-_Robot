#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)"
ARDUINO_CLI="${ARDUINO_CLI:-${HOME}/.build/arduino-cli/arduino-cli}"
ARDUINO_CLI_CONFIG="${ARDUINO_CLI_CONFIG:-${HOME}/.build/arduino-cli/arduino-cli.yaml}"
ARDUINO_LIBRARY_DIR="${ARDUINO_LIBRARY_DIR:-${HOME}/Arduino/libraries}"
ARDUINO_BUILD_DIR="${ARDUINO_BUILD_DIR:-${HOME}/.build/cafe-robot-core2}"

if [[ -z "${ESP32_SERIAL:-}" ]]; then
  echo "Set ESP32_SERIAL to the ESP32 serial port, for example:"
  echo "  ESP32_SERIAL=/dev/ttyUSB1 ./upload_cafe_robot.sh"
  exit 2
fi

if [[ ! -x "${ARDUINO_CLI}" ]]; then
  echo "Arduino CLI not found: ${ARDUINO_CLI}" >&2
  exit 2
fi

"${ARDUINO_CLI}" \
  --config-file "${ARDUINO_CLI_CONFIG}" \
  compile \
  --fqbn esp32:esp32:esp32 \
  --libraries "${ARDUINO_LIBRARY_DIR}" \
  --build-path "${ARDUINO_BUILD_DIR}" \
  "${PROJECT_ROOT}/Arduino/cafe_robot_microros"

exec "${ARDUINO_CLI}" \
  --config-file "${ARDUINO_CLI_CONFIG}" \
  upload \
  --fqbn esp32:esp32:esp32 \
  --port "$ESP32_SERIAL" \
  --verify \
  --input-dir "${ARDUINO_BUILD_DIR}"
