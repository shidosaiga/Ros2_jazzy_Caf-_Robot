# ESP32 firmware

Compiled for the classic ESP32 Dev Module, ESP32 Arduino core 2.0.2, and
micro-ROS Arduino `2.0.8-jazzy`. It subscribes to `/cmd_vel` and publishes
encoder odometry to `/odom` plus raw MPU6500 data to `/imu/data_raw`.

Dependencies are installed separately from this repository:

- micro-ROS Arduino: <https://github.com/micro-ROS/micro_ros_arduino/tree/2.0.8-jazzy>
- Bolder Flight Systems MPU9250/MPU6500 library: <https://github.com/bolderflight/MPU9250/releases/tag/v6.0.3>

Install them in `$HOME/Arduino/libraries` and ensure Arduino CLI has the ESP32
core installed. Compile and upload from the repository root:

```bash
ESP32_SERIAL=/dev/ttyUSB1 ./upload_cafe_robot.sh
```

The script compiles before upload. It uses USB serial at 460800 baud for
micro-ROS; the Agent baud rate in `start_robot.sh` must match. `/cmd_vel` uses
best-effort QoS with queue depth 1. A 500 ms command watchdog stops the motors
if commands stop arriving.

Wheel radius, wheel base, encoder ticks, and maximum speed in the sketch must
be calibrated on the actual robot. The current motor command mapping is open
loop; validate wheel directions and odometry with the wheels lifted before
driving on the floor.
