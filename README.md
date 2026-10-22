# Autonomous Café Delivery Robot — ROS 2 Jazzy

โค้ดต้นทางสำหรับหุ่นส่งของแบบ differential drive ใช้ ROS 2 Jazzy, Raspberry Pi,
ESP32/micro-ROS, YDLidar X3 และ Raspberry Pi AI Camera (IMX500)

> **สถานะ:** ระบบ LiDAR/SLAM, ESP32 topics และหน้าเว็บมีการทดสอบแยกส่วนแล้ว
> แต่ repository นี้ยังไม่มีแผนที่ร้านที่บันทึกไว้หรือ Nav2 configuration สำหรับ
> ตัวถังจริง เว็บให้กำหนดพิกัดโต๊ะบนแผนที่ได้ แต่ยังไม่มี Nav2 สำหรับวิ่งไปยัง
> เป้าหมาย จึงยังไม่พร้อมส่งของอัตโนมัติในพื้นที่จริง

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

## ทดสอบขับผ่านเว็บ

หลังเชื่อมต่อ rosbridge แล้ว แผง “ควบคุมทดสอบ” ส่ง `/cmd_vel` ไป ESP32 โดยตรง
โดยไม่ใช้แผนที่ เลือกระดับ `1`, `1.5`, `2`, `2.5`, `4` หรือ `5`:
ปุ่มทิศทางเดินหน้า/ถอยหลังได้สูงสุด `0.10–0.50 m/s` และหมุนซ้าย/ขวาได้
`1.0–5.0 rad/s` ครั้งละ 1.5 วินาที ส่วน joystick ลากได้ทุกทิศทางและหยุดเมื่อ
ปล่อย ใช้ระดับเดียวกันเพื่อกำหนดความเร็วสูงสุด แล้วส่งคำสั่งศูนย์หลายครั้งเพื่อหยุด
มอเตอร์ยังมี watchdog บน ESP32 หยุดสำรองเมื่อไม่ได้รับคำสั่งนานเกิน 500 ms

ปุ่มนี้ใช้ตรวจการสื่อสารและทิศทางมอเตอร์ ไม่ใช่การนำทางไปยังโต๊ะ การส่งเป้าหมาย
ผ่าน `/goal_pose` ต้องใช้ Nav2 ซึ่งยังไม่ได้เปิดใน `start_robot.sh`.

## ตั้งตำแหน่งโต๊ะบนแผนที่

เมื่อเว็บได้รับ `/map` แล้ว กด “กำหนดตำแหน่งบนแผนที่”, เลือกหมายเลขโต๊ะ
แล้วแตะตำแหน่งบนแผนที่ จุดโต๊ะที่ตั้งไว้จะแสดงบนแผนที่และปุ่มโต๊ะจะเปิดให้สั่งงาน
ตำแหน่งเก็บใน `localStorage` ของ browser ที่ใช้ตั้งโต๊ะเท่านั้น จึงต้องตั้งบน
อุปกรณ์ที่จะใช้สั่งหุ่น หรือย้ายไปเก็บในไฟล์/บริการกลางเมื่อทำระบบใช้งานจริง

เว็บส่งเป้าหมายไป `/goal_pose`; ต้องเปิด Nav2 และ localization บนแผนที่เดียวกัน
ก่อนหุ่นจะวางแผนและวิ่งไปยังโต๊ะได้

## เว็บบนมือถือ

หน้าเว็บจัดเป็นคอลัมน์เดียวบนจอเล็ก และย้าย Log ไว้ใต้กล้อง เปิดจากมือถือที่อยู่
ในเครือข่ายเดียวกับ Pi ได้ที่ `http://<IP-ของ-Pi>:3000` แล้วเชื่อม rosbridge
ด้วย `<IP-ของ-Pi>:9090`

## ทดสอบเลือกความแรงจาก console

```bash
./console_drive.sh left 1.5
./console_drive.sh right 2
./console_drive.sh forward 1
./console_drive.sh backward 2.5
```

หรือเรียก `./console_drive.sh` เพื่อเลือกทิศทางและระดับแบบ interactive ระดับซ้าย/
ขวาคือ `angular.z` หน่วย rad/s ส่วนหน้า/หลังแปลงระดับเป็น `0.10` ถึง `0.25 m/s`
เพื่อไม่ส่งค่าระดับ 1–2.5 ไปเป็น m/s ตรง ๆ สคริปต์ส่งคำสั่งราว 1.5 วินาที,
ส่งศูนย์เมื่อจบหรือกด Ctrl-C และเช็กก่อนว่ามี subscriber `esp32_robot`.
เริ่มที่ระดับ 1 โดยยกล้อพ้นพื้น; ระดับหมุน 2.5 ทำให้ล้อหมุนเร็วขึ้นมาก.

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

## ปิดหรือรีสตาร์ต Raspberry Pi

หน้าเว็บมีปุ่ม `รีสตาร์ต Pi` และ `ปิดเครื่อง` ในแถบด้านบน ทั้งสองปุ่มมีหน้าต่าง
ยืนยันก่อนทำงาน และส่งคำสั่งหยุดมอเตอร์ก่อนเรียก systemd. เว็บคุมเครื่องผ่าน
`robot_web_server.py` ซึ่ง `start_robot.sh` เปิดแทน Python static server เดิม
ดังนั้น `robot.service` ต้องรันเป็น root (ค่าเริ่มต้นของ systemd หากไม่ได้กำหนด
`User=`) และต้องเปิดเว็บจาก origin เดียวกับ Pi

สั่งจาก terminal/SSH ได้เช่นกัน:

```bash
# รีสตาร์ต Pi
sudo systemctl reboot

# ปิด Pi
sudo systemctl poweroff
```

หลังสั่งปิดเครื่อง ไฟเลี้ยงจะยังอยู่จนกว่าจะถอดแหล่งจ่ายไฟ; อย่าถอดไฟขณะกำลัง
เขียนข้อมูลลง SD card

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
