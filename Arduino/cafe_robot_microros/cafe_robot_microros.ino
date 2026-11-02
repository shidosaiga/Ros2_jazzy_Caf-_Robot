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
#define WHEEL_RADIUS 0.0425f  // 85 mm wheel diameter / 2; refine under load
#define WHEEL_BASE 0.314f     // calibrated from a physical 90-degree turn
#define PPR 11
#define GEAR_RATIO 21  // refined from a second measured 1.20 m run
#define TICKS_PER_REV (PPR * GEAR_RATIO)
#define MAX_WHEEL_SPEED_MPS 0.5f
#define CMD_TIMEOUT_MS 500
#define PUBLISH_PERIOD_MS 50
#define WHEEL_PID_KP 180.0f      // PWM per m/s of wheel-speed error
#define WHEEL_PID_KI 70.0f       // PWM per (m/s * second)
#define WHEEL_PID_I_LIMIT 0.5f   // seconds of accumulated speed error
#define HEADING_HOLD_KP 1.5f     // rad/s per radian of heading error
#define HEADING_HOLD_KD 0.18f    // rad/s per rad/s of filtered gyro rate
#define HEADING_HOLD_MAX_RADPS 0.22f
#define HEADING_HOLD_DEADBAND_RAD 0.0087f  // about 0.5 degree
#define GYRO_RATE_FILTER_TAU_S 0.08f
#define WHEEL_SPEED_FILTER_TAU_S 0.075f
#define IMU_GYRO_Z_SIGN -1.0f  // Hand-rotation check: MPU Z is opposite base_link +Z
#define IMU_GYRO_CAL_SAMPLES 200
#define MICRO_ROS_SERIAL_BAUD 460800
#define TIME_SYNC_PERIOD_MS 5000
#define TIME_SYNC_TIMEOUT_MS 20

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
static float imu_gyro_bias_z = 0.0f;
static float imu_yaw = 0.0f;
static float imu_yaw_target = 0.0f;
static float imu_gyro_z_corrected = 0.0f;
static float imu_gyro_z_filtered = 0.0f;
static float target_linear = 0.0f;
static float target_angular = 0.0f;
static float target_vL = 0.0f;
static float target_vR = 0.0f;
static float wheel_iL = 0.0f;
static float wheel_iR = 0.0f;
static float filtered_vL = 0.0f;
static float filtered_vR = 0.0f;
static bool heading_hold_active = false;
static uint32_t last_cmd_ms = 0;
static uint32_t last_publish_ms = 0;
static uint32_t last_imu_update_ms = 0;
static uint32_t last_time_sync_ms = 0;

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
  // The right encoder is mirrored relative to the left encoder. Invert its
  // count so a forward wheel rotation is positive for both sides.
  enc_R -= (digitalRead(ENC_B_R) == HIGH) ? 1 : -1;
  portEXIT_CRITICAL_ISR(&encoder_mux);
}

static void cmdVelCallback(const void *msgin) {
  const geometry_msgs__msg__Twist *msg =
      static_cast<const geometry_msgs__msg__Twist *>(msgin);
  const float linear = static_cast<float>(msg->linear.x);
  const float angular = static_cast<float>(msg->angular.z);

  target_linear = constrain(linear, -MAX_WHEEL_SPEED_MPS, MAX_WHEEL_SPEED_MPS);
  target_angular = constrain(angular, -2.0f, 2.0f);

  const bool imu_fresh = last_imu_update_ms != 0 &&
      static_cast<uint32_t>(millis() - last_imu_update_ms) < 250;
  const bool should_hold_heading = imu_ready && imu_fresh &&
                                  fabsf(target_linear) > 0.03f &&
                                  fabsf(target_angular) < 0.01f;
  if (should_hold_heading && !heading_hold_active) {
    imu_yaw_target = imu_yaw;
  }
  heading_hold_active = should_hold_heading;
  if (fabsf(target_linear) < 0.01f && fabsf(target_angular) < 0.01f) {
    wheel_iL = 0.0f;
    wheel_iR = 0.0f;
  }

  last_cmd_ms = millis();
}

static float wrapAngle(float angle) {
  while (angle > PI) angle -= 2.0f * PI;
  while (angle < -PI) angle += 2.0f * PI;
  return angle;
}

static int wheelSpeedToPwm(float target, float measured, float *integral, float dt) {
  if (fabsf(target) < 0.01f) {
    *integral = 0.0f;
    return 0;
  }
  const float error = target - measured;
  const float feedforward = target / MAX_WHEEL_SPEED_MPS * 255.0f;
  const float proportional = feedforward + WHEEL_PID_KP * error;

  // Conditional integration prevents a saturated motor from winding up and
  // then surging when it leaves the PWM limit.
  const float candidate_i = constrain(*integral + error * dt,
                                      -WHEEL_PID_I_LIMIT, WHEEL_PID_I_LIMIT);
  const float candidate_output = proportional + WHEEL_PID_KI * candidate_i;
  if ((candidate_output <= 255.0f && candidate_output >= -255.0f) ||
      (candidate_output > 255.0f && error < 0.0f) ||
      (candidate_output < -255.0f && error > 0.0f)) {
    *integral = candidate_i;
  }
  const float output = proportional + WHEEL_PID_KI * *integral;
  return static_cast<int>(constrain(output, -255.0f, 255.0f));
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
  const float measured_vL = distL / dt;
  const float measured_vR = distR / dt;
  const float wheel_filter_alpha = dt / (WHEEL_SPEED_FILTER_TAU_S + dt);
  filtered_vL += wheel_filter_alpha * (measured_vL - filtered_vL);
  filtered_vR += wheel_filter_alpha * (measured_vR - filtered_vR);
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
    // Convert the mounted MPU6500's Z direction into base_link/ROS +Z.
    imu_gyro_z_corrected =
        (imu.gyro_z_radps() - imu_gyro_bias_z) * IMU_GYRO_Z_SIGN;
    float imu_dt = dt;
    if (last_imu_update_ms != 0) {
      imu_dt = (now_ms - last_imu_update_ms) / 1000.0f;
    }
    last_imu_update_ms = now_ms;
    if (imu_dt > 0.0f && imu_dt < 0.25f) {
      imu_yaw = wrapAngle(imu_yaw + imu_gyro_z_corrected * imu_dt);
    }
    const float filter_alpha = imu_dt > 0.0f
        ? imu_dt / (GYRO_RATE_FILTER_TAU_S + imu_dt)
        : 1.0f;
    imu_gyro_z_filtered += filter_alpha *
        (imu_gyro_z_corrected - imu_gyro_z_filtered);
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

  // Fail safe if ROS stops sending commands; never keep a stale PID setpoint.
  if (static_cast<uint32_t>(now_ms - last_cmd_ms) > CMD_TIMEOUT_MS) {
    target_linear = 0.0f;
    target_angular = 0.0f;
    heading_hold_active = false;
    wheel_iL = 0.0f;
    wheel_iR = 0.0f;
    stopMotors();
    return;
  }

  float corrected_angular = target_angular;
  if (heading_hold_active) {
    float heading_error = wrapAngle(imu_yaw_target - imu_yaw);
    if (fabsf(heading_error) < HEADING_HOLD_DEADBAND_RAD) {
      heading_error = 0.0f;
    }
    const float correction = constrain(
        HEADING_HOLD_KP * heading_error - HEADING_HOLD_KD * imu_gyro_z_filtered,
        -HEADING_HOLD_MAX_RADPS, HEADING_HOLD_MAX_RADPS);
    corrected_angular += correction;
  }
  target_vL = target_linear - corrected_angular * WHEEL_BASE * 0.5f;
  target_vR = target_linear + corrected_angular * WHEEL_BASE * 0.5f;
  const float largest = fmaxf(fabsf(target_vL), fabsf(target_vR));
  if (largest > MAX_WHEEL_SPEED_MPS) {
    const float scale = MAX_WHEEL_SPEED_MPS / largest;
    target_vL *= scale;
    target_vR *= scale;
  }
  setMotorL(wheelSpeedToPwm(target_vL, filtered_vL, &wheel_iL, dt));
  setMotorR(wheelSpeedToPwm(target_vR, filtered_vR, &wheel_iR, dt));
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
  if (imu_ready) {
    // Keep the chassis still during boot so gyro bias can be measured once.
    float bias_sum = 0.0f;
    int valid_samples = 0;
    for (int i = 0; i < IMU_GYRO_CAL_SAMPLES; ++i) {
      if (imu.Read()) {
        bias_sum += imu.gyro_z_radps();
        ++valid_samples;
      }
      delay(5);
    }
    if (valid_samples > IMU_GYRO_CAL_SAMPLES / 2) {
      imu_gyro_bias_z = bias_sum / static_cast<float>(valid_samples);
    } else {
      imu_ready = false;
    }
  }

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

  // Synchronize the epoch used by ROS message stamps with the Agent.
  if (rmw_uros_sync_session(1000) != RMW_RET_OK ||
      !rmw_uros_epoch_synchronized()) {
    failStop();
  }
  last_cmd_ms = millis();
  last_publish_ms = millis();
  last_time_sync_ms = millis();
}

void loop() {
  rclc_executor_spin_some(&executor, RCL_MS_TO_NS(10));
  const uint32_t now_ms = millis();
  if (static_cast<uint32_t>(now_ms - last_time_sync_ms) >=
      TIME_SYNC_PERIOD_MS) {
    // Retry periodically so Pi clock corrections do not leave ESP32 stamps
    // behind. Keep the timeout short so command handling remains responsive.
    last_time_sync_ms = now_ms;
    (void)rmw_uros_sync_session(TIME_SYNC_TIMEOUT_MS);
  }
  delay(5);
}
