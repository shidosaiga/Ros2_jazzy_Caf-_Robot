#!/usr/bin/env python3
"""Safely pulse the wheels until encoder odometry detects motion, then stop."""

import math
import os
import signal
import subprocess
import time

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from rclpy.qos import qos_profile_sensor_data


TEST_LINEAR_MPS = 0.30
COMMAND_RATE_HZ = 10.0
MAX_WAIT_FOR_MOTION_SECONDS = 4.0
POST_DETECTION_RUN_SECONDS = 1.5
MIN_RUN_BEFORE_DETECT_SECONDS = 0.25
STOP_HOLD_SECONDS = 0.5
CLI_STOP_GRACE_SECONDS = 0.2
ODOM_START_TIMEOUT_SECONDS = 10.0
ODOM_FRESH_SECONDS = 0.5
POSITION_DELTA_METERS = 0.002
YAW_DELTA_RADIANS = 0.02
LINEAR_SPEED_MPS = 0.01
ANGULAR_SPEED_RADPS = 0.03


def yaw_from_quaternion(q):
    sin_yaw = 2.0 * (q.w * q.z + q.x * q.y)
    cos_yaw = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
    return math.atan2(sin_yaw, cos_yaw)


def angle_delta(a, b):
    return math.atan2(math.sin(a - b), math.cos(a - b))


class MotorTestUntilOdom(Node):
    def __init__(self):
        super().__init__('motor_test_until_odom')
        cmd_qos = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
            reliability=ReliabilityPolicy.BEST_EFFORT,
        )
        self.cmd_pub = self.create_publisher(Twist, '/cmd_vel', cmd_qos)
        self.odom_sub = self.create_subscription(
            Odometry, '/odom', self.on_odom, qos_profile_sensor_data)

        self.started_at = time.monotonic()
        self.command_started_at = None
        self.motion_detected_at = None
        self.stop_started_at = None
        self.state = 'waiting_for_odom'
        self.finished = False
        self.baseline = None
        self.latest_odom = None
        self.last_odom_at = None
        self.last_readiness_log_at = self.started_at
        self.command_process = None
        self.timer = self.create_timer(1.0 / COMMAND_RATE_HZ, self.on_timer)
        self.get_logger().info(
            'Waiting for fresh /odom and the ESP32 /cmd_vel subscriber. '
            'After encoder motion, test continues for 1.5 seconds; without '
            'motion it stops after 4 seconds.')

    def on_odom(self, msg):
        self.latest_odom = msg
        self.last_odom_at = time.monotonic()

        if self.state != 'running' or self.baseline is None:
            return
        if self.command_started_at is None:
            return
        now = time.monotonic()
        if now - self.command_started_at < MIN_RUN_BEFORE_DETECT_SECONDS:
            return
        if now - self.command_started_at > MAX_WAIT_FOR_MOTION_SECONDS:
            return

        p = msg.pose.pose.position
        q = msg.pose.pose.orientation
        x0, y0, yaw0 = self.baseline
        moved = math.hypot(p.x - x0, p.y - y0) >= POSITION_DELTA_METERS
        turned = abs(angle_delta(yaw_from_quaternion(q), yaw0)) >= YAW_DELTA_RADIANS
        speed_detected = (
            abs(msg.twist.twist.linear.x) >= LINEAR_SPEED_MPS or
            abs(msg.twist.twist.angular.z) >= ANGULAR_SPEED_RADPS
        )
        if moved or turned or speed_detected:
            if self.motion_detected_at is None:
                self.motion_detected_at = now
                self.get_logger().info(
                    'Encoder movement detected in /odom. '
                    f'Continuing for {POST_DETECTION_RUN_SECONDS:.1f} '
                    'seconds before stopping.')

    def publish_stop(self):
        self.cmd_pub.publish(Twist())

    def start_cli_motor_command(self):
        command = [
            'ros2', 'topic', 'pub',
            '--qos-reliability', 'best_effort',
            '--rate', str(int(COMMAND_RATE_HZ)),
            '/cmd_vel', 'geometry_msgs/msg/Twist',
            f'{{linear: {{x: {TEST_LINEAR_MPS:.2f}}}, '
            'angular: {z: 0.0}}',
        ]
        self.command_process = subprocess.Popen(command, start_new_session=True)

    def signal_cli_motor_stop(self):
        if self.command_process is None or self.command_process.poll() is not None:
            return
        try:
            # Stop the whole ros2 CLI process group immediately. The ESP32's
            # 500 ms watchdog remains a second stop path if this signal fails.
            os.killpg(self.command_process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass

    def force_kill_cli_motor_publisher(self):
        if self.command_process is None or self.command_process.poll() is not None:
            return
        try:
            os.killpg(self.command_process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def begin_stop(self, reason):
        if self.state == 'stopping' or self.finished:
            return
        self.state = 'stopping'
        self.stop_started_at = time.monotonic()
        self.signal_cli_motor_stop()
        self.get_logger().info(f'{reason} Sending zero velocity.')

    def on_timer(self):
        now = time.monotonic()

        if self.state == 'waiting_for_odom':
            self.publish_stop()
            odom_fresh = (
                self.latest_odom is not None and
                self.last_odom_at is not None and
                now - self.last_odom_at <= ODOM_FRESH_SECONDS
            )
            cmd_subscribers = self.cmd_pub.get_subscription_count()
            if odom_fresh and cmd_subscribers > 0:
                p = self.latest_odom.pose.pose.position
                q = self.latest_odom.pose.pose.orientation
                self.baseline = (p.x, p.y, yaw_from_quaternion(q))
                self.state = 'running'
                self.command_started_at = now
                self.get_logger().info(
                    f'Starting ros2 topic pub forward test at '
                    f'{TEST_LINEAR_MPS:.2f} m/s; waiting up to '
                    f'{MAX_WAIT_FOR_MOTION_SECONDS:.1f} seconds for encoder '
                    f'motion, then continuing for '
                    f'{POST_DETECTION_RUN_SECONDS:.1f} seconds.')
                self.start_cli_motor_command()
            elif now - self.started_at >= ODOM_START_TIMEOUT_SECONDS:
                self.get_logger().error(
                    f'Readiness timeout: fresh_odom={odom_fresh}, '
                    f'cmd_vel_subscribers={cmd_subscribers}. '
                    'Motor test was not started.')
                self.finished = True
            elif now - self.last_readiness_log_at >= 1.0:
                self.get_logger().info(
                    f'Waiting: fresh_odom={odom_fresh}, '
                    f'cmd_vel_subscribers={cmd_subscribers}.')
                self.last_readiness_log_at = now
            return

        if self.state == 'running':
            if (self.motion_detected_at is not None and
                    now - self.motion_detected_at >= POST_DETECTION_RUN_SECONDS):
                self.begin_stop('Encoder movement hold time complete.')
                return
            if (self.motion_detected_at is None and
                    now - self.command_started_at >= MAX_WAIT_FOR_MOTION_SECONDS):
                self.begin_stop('No encoder movement detected before timeout.')
                return
            if (self.command_process is not None and
                    self.command_process.poll() is not None):
                self.begin_stop(
                    'ros2 topic pub exited unexpectedly; sending stop.')
            return

        if self.state == 'stopping':
            # Publish zero on the already-matched probe publisher while the
            # CLI command process shuts down; do not block waiting on a new CLI.
            self.publish_stop()
            if (self.command_process is not None and
                    self.command_process.poll() is None and
                    now - self.stop_started_at >= CLI_STOP_GRACE_SECONDS):
                self.force_kill_cli_motor_publisher()
            if now - self.stop_started_at >= STOP_HOLD_SECONDS:
                self.get_logger().info('Motor test finished; zero command sent.')
                self.finished = True


def main():
    rclpy.init()
    node = MotorTestUntilOdom()
    try:
        while rclpy.ok() and not node.finished:
            rclpy.spin_once(node, timeout_sec=0.1)
    except KeyboardInterrupt:
        node.get_logger().warning('Interrupted; sending stop command.')
        node.signal_cli_motor_stop()
        for _ in range(5):
            node.publish_stop()
            rclpy.spin_once(node, timeout_sec=0.02)
    finally:
        node.signal_cli_motor_stop()
        node.force_kill_cli_motor_publisher()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
