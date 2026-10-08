#!/bin/bash
PROJECT_ROOT="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)"
sleep 10  # รอ Pi boot เสร็จก่อน

# ค่าเริ่มต้นสำหรับ robot.service: ESP32 อยู่ที่ USB1 และ LiDAR ที่ USB0
USE_ESP32_ODOM="${USE_ESP32_ODOM:-1}"
ESP32_SERIAL="${ESP32_SERIAL:-/dev/ttyUSB1}"
LIDAR_SERIAL="${LIDAR_SERIAL:-/dev/ttyUSB0}"

# เริ่ม container
docker start ros2-bridge

sleep 5  # รอ container พร้อม

# รัน LiDAR
docker exec ros2-bridge bash -c "
source /opt/ros/jazzy/setup.bash && \
source /ros2_ws/install/setup.bash && \
ros2 run ydlidar_ros2_driver ydlidar_ros2_driver_node --ros-args \
  -p port:=${LIDAR_SERIAL} \
  -p baudrate:=115200 \
  -p lidar_type:=1 \
  -p isSingleChannel:=true \
  -p frame_id:=laser_frame \
  -p frequency:=6.0" &

sleep 3

# เลือก odometry จาก ESP32 หรือ fake_odom ระหว่างพัฒนา
if [ "${USE_ESP32_ODOM:-0}" = "1" ]; then
  if [ -z "${ESP32_SERIAL:-}" ]; then
    echo "ตั้งค่า ESP32_SERIAL ก่อน เช่น /dev/ttyACM0 หรือ /dev/ttyUSB1"
    exit 1
  fi
  if [ ! -e "${ESP32_SERIAL}" ]; then
    echo "ไม่พบ serial device: ${ESP32_SERIAL}"
    exit 1
  fi
  docker rm -f micro-ros-agent >/dev/null 2>&1 || true
  docker run -d --rm --name micro-ros-agent --network host \
    --device="${ESP32_SERIAL}:${ESP32_SERIAL}" \
    microros/micro-ros-agent:jazzy serial \
      --dev "${ESP32_SERIAL}" --baudrate 460800

  # ESP32 publishes /odom; convert it to odom -> base_link TF for SLAM/Nav2.
  docker exec ros2-bridge bash -c \
    "source /opt/ros/jazzy/setup.bash && python3 /odom_to_tf.py" &
  docker exec ros2-bridge bash -c \
    "source /opt/ros/jazzy/setup.bash && ros2 run tf2_ros static_transform_publisher --z 0.1 --frame-id base_link --child-frame-id laser_frame" &
else
  docker exec ros2-bridge bash -c "
  source /opt/ros/jazzy/setup.bash && \
  python3 /fake_odom.py" &
fi

sleep 3

# รัน SLAM
docker exec ros2-bridge bash -c "
source /opt/ros/jazzy/setup.bash && \
ros2 launch slam_toolbox online_async_launch.py \
  slam_params_file:=/slam_params.yaml \
  use_sim_time:=false" &

sleep 3

# รัน Foxglove
docker exec ros2-bridge bash -c "
source /opt/ros/jazzy/setup.bash && \
ros2 launch foxglove_bridge foxglove_bridge_launch.xml" &

# รัน Camera
python3 "${PROJECT_ROOT}/imx500_publisher.py" &

# Serve the prebuilt React app. `npm start` runs the development server and
# consumes extra CPU/RAM on the Pi; rebuild manually after changing the UI.
if [ -d "${PROJECT_ROOT}/cafe-robot-ui/dist" ]; then
  python3 -m http.server 3000 --bind 0.0.0.0 \
    --directory "${PROJECT_ROOT}/cafe-robot-ui/dist" &
else
  echo "ไม่พบ cafe-robot-ui/dist — รัน npm run build ใน ${PROJECT_ROOT}/cafe-robot-ui ก่อน"
fi
