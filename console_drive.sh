#!/usr/bin/env bash
set -Eeuo pipefail

ROS_SETUP="source /opt/ros/jazzy/setup.bash"

direction="${1:-}"
strength="${2:-}"

if [[ -z "$direction" ]]; then
  read -r -p "ทิศทาง [f=หน้า, b=ถอย, l=ซ้าย, r=ขวา]: " direction
fi
if [[ -z "$strength" ]]; then
  read -r -p "ระดับความแรง [1 / 1.5 / 2 / 2.5]: " strength
fi

case "$strength" in
  1|1.0)  strength="1.0"; linear_speed="0.10" ;;
  1.5)    strength="1.5"; linear_speed="0.15" ;;
  2|2.0)  strength="2.0"; linear_speed="0.20" ;;
  2.5)    strength="2.5"; linear_speed="0.25" ;;
  *)
    echo "เลือกระดับได้เฉพาะ 1, 1.5, 2 หรือ 2.5" >&2
    exit 2
    ;;
esac

linear="0.0"
angular="0.0"
case "$direction" in
  f|forward)
    linear="$linear_speed"
    label="เดินหน้า"
    ;;
  b|back|backward)
    linear="-${linear_speed}"
    label="ถอยหลัง"
    ;;
  l|left)
    angular="$strength"
    label="หมุนซ้าย"
    ;;
  r|right)
    angular="-${strength}"
    label="หมุนขวา"
    ;;
  *)
    echo "ทิศทางไม่ถูกต้อง ใช้ f, b, l หรือ r" >&2
    exit 2
    ;;
esac

topic_info="$(sudo docker exec ros2-bridge bash -lc \
  'source /opt/ros/jazzy/setup.bash && ros2 topic info /cmd_vel --verbose')" || {
  echo "อ่าน /cmd_vel ไม่ได้ ตรวจว่า container ros2-bridge ทำงานอยู่" >&2
  exit 1
}
if ! grep -q 'Node name: esp32_robot' <<<"$topic_info"; then
  echo "$topic_info"
  echo "ไม่พบ subscriber esp32_robot ที่ /cmd_vel — ไม่เริ่มหมุนมอเตอร์" >&2
  exit 1
fi

send_stop() {
  timeout 5s sudo docker exec ros2-bridge bash -lc \
    "$ROS_SETUP && ros2 topic pub --qos-reliability best_effort --rate 10 --times 5 /cmd_vel geometry_msgs/msg/Twist '{linear: {x: 0.0}, angular: {z: 0.0}}'" \
    >/dev/null 2>&1 || true
}

# Ensure a zero command is attempted on normal exit or Ctrl-C. The ESP32's
# 500 ms command watchdog remains the backup if this terminal/network vanishes.
trap send_stop EXIT INT TERM

if [[ "$direction" == l || "$direction" == left || "$direction" == r || "$direction" == right ]]; then
  echo "$label ระดับ $strength rad/s ประมาณ 1.5 วินาที แล้วหยุด"
else
  echo "$label ระดับ $strength (ความเร็ว $linear_speed m/s) ประมาณ 1.5 วินาที แล้วหยุด"
fi

timeout 8s sudo docker exec ros2-bridge bash -lc \
  "$ROS_SETUP && ros2 topic pub --qos-reliability best_effort --rate 10 --times 15 /cmd_vel geometry_msgs/msg/Twist '{linear: {x: $linear}, angular: {z: $angular}}'"
