# Autonomous Café Delivery Robot — ROS 2 Jazzy

โค้ดต้นทางสำหรับหุ่นส่งของแบบ differential drive ใช้ ROS 2 Jazzy, Raspberry Pi,
ESP32/micro-ROS, YDLidar X3 และ Raspberry Pi AI Camera (IMX500)

> **สถานะ:** ระบบ LiDAR/SLAM, ESP32 topics และหน้าเว็บมีการทดสอบแยกส่วนแล้ว
> แต่ repository นี้ยังไม่มีแผนที่ร้านที่บันทึกไว้หรือ Nav2 configuration สำหรับ
> ตัวถังจริง พิกัดโต๊ะในเว็บยังเป็นตัวอย่าง จึงยังไม่พร้อมวิ่งส่งของอัตโนมัติ
> ในพื้นที่จริง

## โครงสร้าง

- `Arduino/cafe_robot_microros/` — ESP32 firmware: `/cmd_vel`, `/odom`, `/imu/data_raw`
- `ros2-docker/` — Dockerfile และ ROS helper nodes
- `cafe-robot-ui/` — React + Vite dashboard ที่เชื่อม ROS ผ่าน rosbridge
- `imx500_publisher.py` — Pi Camera AI publisher และ person-stop topic
- `slam_params.yaml` — SLAM Toolbox mapping parameters
- `start_robot.sh` — startup script สำหรับ LiDAR, micro-ROS Agent, SLAM, กล้อง และเว็บ
- `upload_cafe_robot.sh` — compile และ upload firmware
- `fake_odom.py` — odometry จำลองสำหรับพัฒนา

## ข้อกำหนด

- 64-bit Linux ARM, Docker และ ROS 2 Jazzy container
- Arduino CLI, ESP32 Arduino core 2.0.2 และ micro-ROS Arduino library `2.0.8-jazzy`
- ไลบรารี MPU6500 จาก Bolder Flight Systems InvenSense IMU `6.0.3`
- Node.js 20.19+ สำหรับ Vite 8; production runtime ให้บริการไฟล์ static ใน `dist/`
- Raspberry Pi Camera software/model สำหรับ IMX500 (ติดตั้งแยกจาก repository)

ESP32 libraries เป็น dependencies ภายนอก ไม่ได้ vendored ไว้ใน repository:

- <https://github.com/micro-ROS/micro_ros_arduino/tree/2.0.8-jazzy>
- <https://github.com/bolderflight/MPU9250/releases/tag/v6.0.3>

## Build เว็บ

```bash
cd cafe-robot-ui
npm ci
npm run build
```

Development server: `npm run dev`. ROS bridge ต้องเปิดที่พอร์ต `9090` ของ host
เดียวกับเว็บ หรือแก้ IP ในหน้าเว็บ

## Firmware ESP32

ติดตั้ง dependencies ข้างต้นและ Arduino CLI ให้เรียบร้อย จากนั้นต่อ ESP32 แล้วรัน:

```bash
ESP32_SERIAL=/dev/ttyUSB1 ./upload_cafe_robot.sh
```

สคริปต์ใช้ Arduino CLI และ libraries ที่ `$HOME/Arduino/libraries` โดยตั้งค่า
ตำแหน่งใหม่ผ่าน `ARDUINO_CLI`, `ARDUINO_CLI_CONFIG`, `ARDUINO_LIBRARY_DIR`,
และ `ARDUINO_BUILD_DIR` ได้

## ROS / startup

Dockerfile อยู่ใน `ros2-docker/`; ปัจจุบัน startup script คาดว่ามี container ชื่อ
`ros2-bridge` ซึ่งเตรียม device mapping และ ROS files สำหรับ host นั้นไว้แล้ว
ให้ตรวจ `/dev/ttyUSB0` (LiDAR) และ `/dev/ttyUSB1` (ESP32) หรือกำหนด
`LIDAR_SERIAL` และ `ESP32_SERIAL` ให้ตรงเครื่องก่อนเริ่มระบบ

การเริ่ม SLAM ปัจจุบันเป็นโหมด mapping. เว็บส่ง goal ไป `/goal_pose` แต่
`start_robot.sh` ยังไม่ได้เปิด Nav2; ต้องเพิ่ม Nav2, ตั้ง footprint/frames และ
บันทึก map ก่อนจึงจะนำทางตามจุดได้

## IMU และ outdoor

Firmware ส่ง IMU ดิบจาก MPU6500 โดยยังไม่มี orientation estimate หรือ EKF fusion
ควร calibrate gyro และ fuse กับ encoder odometry ก่อนใช้กับ Nav2
IMU ไม่ให้พิกัด absolute สำหรับ outdoor; ต้องเพิ่ม GNSS และ localization pipeline
สำหรับการนำทางนอกอาคาร

## ความปลอดภัยและข้อมูลที่ไม่ควร commit

- `/safety/person_stop` ถูก publish จาก camera node; ต้องตรวจว่ามี node/controller
  รับสัญญาณและหยุดหุ่นจริงก่อนนำไปใช้กับคน
- ไม่รวม `node_modules`, `dist`, binaries, build output, logs หรือ camera model
- ไม่รวม map ของร้านใน initial source push; map อาจเปิดเผย layout ภายในร้าน
- อย่า commit credentials, `.env`, private keys หรือข้อมูล Wi-Fi
