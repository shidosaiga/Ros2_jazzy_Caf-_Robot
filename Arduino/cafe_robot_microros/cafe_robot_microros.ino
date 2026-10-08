#include <Arduino.h>
#include <Wire.h>
#include "mpu6500.h"

#include <micro_ros_arduino.h>
#include <rcl/rcl.h>
#include <rclc/rclc.h>
#include <rclc/executor.h>
#include <rmw_microros/rmw_microros.h>
#include <geometry_msgs/msg/twist.h>
#include <nav_msgs/msg/odometry.h>
#include <sensor_msgs/msg/imu.h>
#include <rosidl_runtime_c/string_functions.h>

// MDD3A motor inputs
#define MOT_L_A 25
#define MOT_L_B 26
#define MOT_R_A 27
#define MOT_R_B 14

// Encoder A/B. GPIO34/35 are input-only and need external pull-ups if the
// encoder outputs do not already provide them.
#define ENC_A_L 34
#define ENC_B_L 35
#define ENC_A_R 32
#define ENC_B_R 33

// MPU6500 I2C wiring
#define IMU_SDA 21
#define IMU_SCL 22

// Calibrate these against the actual robot before relying on odometry.
#define WHEEL_RADIUS 0.033f
#define WHEEL_BASE 0.20f
#define PPR 11
#define GEAR_RATIO 30
#define TICKS_PER_REV (PPR * GEAR_RATIO)
#define MAX_WHEEL_SPEED_MPS 0.5f
#define CMD_TIMEOUT_MS 500
#define PUBLISH_PERIOD_MS 50
#define MICRO_ROS_SERIAL_BAUD 460800

static bfs::Mpu6500 imu(&Wire, bfs::Mpu6500::I2C_ADDR_PRIM);
static bool imu_ready = false;

static volatile int32_t enc_L = 0;
static volatile int32_t enc_R = 0;
static portMUX_TYPE encoder_mux = portMUX_INITIALIZER_UNLOCKED;
static int32_t prev_enc_L = 0;
static int32_t prev_enc_R = 0;

static float pos_x = 0.0f;
static float pos_y = 0.0f;
static float pos_theta = 0.0f;
static uint32_t last_cmd_ms = 0;
static uint32_t last_publish_ms = 0;

static rcl_subscription_t cmd_vel_sub;
static rcl_publisher_t odom_pub;
static rcl_publisher_t imu_pub;
static geometry_msgs__msg__Twist twist_msg;
static nav_msgs__msg__Odometry odom_msg;
static sensor_msgs__msg__Imu imu_msg;
static rclc_executor_t executor;
static rclc_support_t support;
static rcl_allocator_t allocator;
static rcl_node_t node;
static rcl_timer_t publish_timer;

// Override micro_ros_arduino's weak serial transport so its UART speed matches
// the Agent. Odom + IMU at 20 Hz can saturate the default 115200 baud link.
extern "C" bool arduino_transport_open(struct uxrCustomTransport *transport) {
  (void)transport;
  Serial.begin(MICRO_ROS_SERIAL_BAUD);
  return true;
}

extern "C" bool arduino_transport_close(struct uxrCustomTransport *transport) {
  (void)transport;
  Serial.end();
  return true;
}

extern "C" size_t arduino_transport_write(
    struct uxrCustomTransport *transport, const uint8_t *buffer, size_t length,
    uint8_t *error_code) {
  (void)transport;
  (void)error_code;
  return Serial.write(buffer, length);
}

extern "C" size_t arduino_transport_read(
    struct uxrCustomTransport *transport, uint8_t *buffer, size_t length,
    int timeout_ms, uint8_t *error_code) {
  (void)transport;
  (void)error_code;
  Serial.setTimeout(timeout_ms);
  return Serial.readBytes(reinterpret_cast<char *>(buffer), length);
}

static void stopMotors() {
  analogWrite(MOT_L_A, 0);
  analogWrite(MOT_L_B, 0);
  analogWrite(MOT_R_A, 0);
  analogWrite(MOT_R_B, 0);
}

static void setMotorL(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    analogWrite(MOT_L_A, speed);
    analogWrite(MOT_L_B, 0);
  } else if (speed < 0) {
    analogWrite(MOT_L_A, 0);
    analogWrite(MOT_L_B, -speed);
  } else {
    analogWrite(MOT_L_A, 0);
    analogWrite(MOT_L_B, 0);
  }
}

static void setMotorR(int speed) {
  speed = constrain(speed, -255, 255);
  // No sign inversion: the motor wires have already been swapped.
  if (speed > 0) {
    analogWrite(MOT_R_A, speed);
    analogWrite(MOT_R_B, 0);
  } else if (speed < 0) {
    analogWrite(MOT_R_A, 0);
    analogWrite(MOT_R_B, -speed);
  } else {
    analogWrite(MOT_R_A, 0);
    analogWrite(MOT_R_B, 0);
  }
}

static void failStop() {
  stopMotors();
  while (true) {
    delay(100);
  }
}

static void checkRcl(rcl_ret_t result) {
  if (result != RCL_RET_OK) {
    failStop();
  }
}

static void setRosStamp(builtin_interfaces__msg__Time *stamp) {
  const int64_t epoch_ns = rmw_uros_epoch_nanos();
  if (epoch_ns > 0) {
    stamp->sec = static_cast<int32_t>(epoch_ns / 1000000000LL);
    stamp->nanosec = static_cast<uint32_t>(epoch_ns % 1000000000LL);
  } else {
    stamp->sec = 0;
    stamp->nanosec = 0;
  }
}

static void IRAM_ATTR encL_ISR() {
  portENTER_CRITICAL_ISR(&encoder_mux);
  enc_L += (digitalRead(ENC_B_L) == HIGH) ? 1 : -1;
  portEXIT_CRITICAL_ISR(&encoder_mux);
}

static void IRAM_ATTR encR_ISR() {
  portENTER_CRITICAL_ISR(&encoder_mux);
  enc_R += (digitalRead(ENC_B_R) == HIGH) ? 1 : -1;
  portEXIT_CRITICAL_ISR(&encoder_mux);
}

static void cmdVelCallback(const void *msgin) {
  const geometry_msgs__msg__Twist *msg =
      static_cast<const geometry_msgs__msg__Twist *>(msgin);
  const float linear = static_cast<float>(msg->linear.x);
  const float angular = static_cast<float>(msg->angular.z);

  float vL = linear - angular * WHEEL_BASE * 0.5f;
  float vR = linear + angular * WHEEL_BASE * 0.5f;
  const float largest = fmaxf(fabsf(vL), fabsf(vR));
  if (largest > MAX_WHEEL_SPEED_MPS) {
    const float scale = MAX_WHEEL_SPEED_MPS / largest;
    vL *= scale;
    vR *= scale;
  }

  const int pwmL = static_cast<int>(vL / MAX_WHEEL_SPEED_MPS * 255.0f);
  const int pwmR = static_cast<int>(vR / MAX_WHEEL_SPEED_MPS * 255.0f);
  setMotorL(pwmL);
  setMotorR(pwmR);
  last_cmd_ms = millis();
}

static void publishTimerCallback(rcl_timer_t *timer, int64_t last_call_time) {
  (void)last_call_time;
  if (timer == nullptr) return;

  const uint32_t now_ms = millis();
  float dt = (now_ms - last_publish_ms) / 1000.0f;
  if (dt <= 0.0f) dt = PUBLISH_PERIOD_MS / 1000.0f;
  last_publish_ms = now_ms;

  int32_t ticksL;
  int32_t ticksR;
  portENTER_CRITICAL(&encoder_mux);
  ticksL = enc_L;
  ticksR = enc_R;
  portEXIT_CRITICAL(&encoder_mux);

  const int32_t dL = ticksL - prev_enc_L;
  const int32_t dR = ticksR - prev_enc_R;
  prev_enc_L = ticksL;
  prev_enc_R = ticksR;

  const float meters_per_tick =
      (2.0f * PI * WHEEL_RADIUS) / static_cast<float>(TICKS_PER_REV);
  const float distL = static_cast<float>(dL) * meters_per_tick;
  const float distR = static_cast<float>(dR) * meters_per_tick;
  const float dist = (distL + distR) * 0.5f;
  const float dTheta = (distR - distL) / WHEEL_BASE;

  pos_x += dist * cosf(pos_theta + dTheta * 0.5f);
  pos_y += dist * sinf(pos_theta + dTheta * 0.5f);
  pos_theta += dTheta;
  while (pos_theta > PI) pos_theta -= 2.0f * PI;
  while (pos_theta < -PI) pos_theta += 2.0f * PI;

  setRosStamp(&odom_msg.header.stamp);
  odom_msg.pose.pose.position.x = pos_x;
  odom_msg.pose.pose.position.y = pos_y;
  odom_msg.pose.pose.position.z = 0.0;
  odom_msg.pose.pose.orientation.x = 0.0;
  odom_msg.pose.pose.orientation.y = 0.0;
  odom_msg.pose.pose.orientation.z = sinf(pos_theta * 0.5f);
  odom_msg.pose.pose.orientation.w = cosf(pos_theta * 0.5f);
  odom_msg.twist.twist.linear.x = dist / dt;
  odom_msg.twist.twist.linear.y = 0.0;
  odom_msg.twist.twist.angular.z = dTheta / dt;
  if (rcl_publish(&odom_pub, &odom_msg, nullptr) != RCL_RET_OK) {
    stopMotors();
  }

  if (imu_ready && imu.Read()) {
    setRosStamp(&imu_msg.header.stamp);
    imu_msg.linear_acceleration.x = imu.accel_x_mps2();
    imu_msg.linear_acceleration.y = imu.accel_y_mps2();
    imu_msg.linear_acceleration.z = imu.accel_z_mps2();
    imu_msg.angular_velocity.x = imu.gyro_x_radps();
    imu_msg.angular_velocity.y = imu.gyro_y_radps();
    imu_msg.angular_velocity.z = imu.gyro_z_radps();
    if (rcl_publish(&imu_pub, &imu_msg, nullptr) != RCL_RET_OK) {
      stopMotors();
    }
  }

  // Stop if the ROS command stream disappears; motors start stopped.
  if (static_cast<uint32_t>(now_ms - last_cmd_ms) > CMD_TIMEOUT_MS) {
    stopMotors();
  }
}

void setup() {
  pinMode(MOT_L_A, OUTPUT);
  pinMode(MOT_L_B, OUTPUT);
  pinMode(MOT_R_A, OUTPUT);
  pinMode(MOT_R_B, OUTPUT);
  stopMotors();

  pinMode(ENC_A_L, INPUT);
  pinMode(ENC_B_L, INPUT);
  pinMode(ENC_A_R, INPUT);
  pinMode(ENC_B_R, INPUT);
  attachInterrupt(digitalPinToInterrupt(ENC_A_L), encL_ISR, RISING);
  attachInterrupt(digitalPinToInterrupt(ENC_A_R), encR_ISR, RISING);

  Wire.begin(IMU_SDA, IMU_SCL);
  Wire.setClock(400000);
  imu_ready = imu.Begin();

  // micro-ROS uses USB Serial for its transport; avoid Serial debug output.
  set_microros_transports();
  delay(2000);

  // The robot startup script may launch the Agent after the ESP32 boots.
  // Keep outputs stopped while waiting, then initialize the ROS entities.
  while (rmw_uros_ping_agent(100, 1) != RMW_RET_OK) {
    stopMotors();
    delay(500);
  }

  allocator = rcl_get_default_allocator();
  checkRcl(rclc_support_init(&support, 0, nullptr, &allocator));
  checkRcl(rclc_node_init_default(&node, "esp32_robot", "", &support));

  // Keep only the newest velocity command. Best-effort + depth 1 prevents a
  // backlog of old commands from being replayed after serial congestion.
  rmw_qos_profile_t cmd_vel_qos = rmw_qos_profile_default;
  cmd_vel_qos.history = RMW_QOS_POLICY_HISTORY_KEEP_LAST;
  cmd_vel_qos.depth = 1;
  cmd_vel_qos.reliability = RMW_QOS_POLICY_RELIABILITY_BEST_EFFORT;
  checkRcl(rclc_subscription_init(
      &cmd_vel_sub, &node,
      ROSIDL_GET_MSG_TYPE_SUPPORT(geometry_msgs, msg, Twist), "/cmd_vel",
      &cmd_vel_qos));
  checkRcl(rclc_publisher_init_default(
      &odom_pub, &node,
      ROSIDL_GET_MSG_TYPE_SUPPORT(nav_msgs, msg, Odometry), "/odom"));
  checkRcl(rclc_publisher_init_default(
      &imu_pub, &node,
      ROSIDL_GET_MSG_TYPE_SUPPORT(sensor_msgs, msg, Imu), "/imu/data_raw"));

  if (!rosidl_runtime_c__String__assign(&odom_msg.header.frame_id, "odom") ||
      !rosidl_runtime_c__String__assign(&odom_msg.child_frame_id, "base_link") ||
      !rosidl_runtime_c__String__assign(&imu_msg.header.frame_id, "imu_link")) {
    failStop();
  }
  // orientation is intentionally unavailable from the 6-axis MPU6500.
  imu_msg.orientation_covariance[0] = -1.0;

  checkRcl(rclc_timer_init_default2(
      &publish_timer, &support, RCL_MS_TO_NS(PUBLISH_PERIOD_MS),
      publishTimerCallback, true));
  checkRcl(rclc_executor_init(&executor, &support.context, 2, &allocator));
  checkRcl(rclc_executor_add_subscription(
      &executor, &cmd_vel_sub, &twist_msg, cmdVelCallback, ON_NEW_DATA));
  checkRcl(rclc_executor_add_timer(&executor, &publish_timer));

  // Use the Agent's synchronized clock for ROS message timestamps.
  rmw_uros_sync_session(1000);
  last_cmd_ms = millis();
  last_publish_ms = millis();
}

void loop() {
  rclc_executor_spin_some(&executor, RCL_MS_TO_NS(10));
  delay(5);
}
