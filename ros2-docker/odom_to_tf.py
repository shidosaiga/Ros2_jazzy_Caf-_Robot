#!/usr/bin/env python3
import rclpy
from geometry_msgs.msg import TransformStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from tf2_ros import TransformBroadcaster


class OdomToTf(Node):
    def __init__(self):
        super().__init__('odom_to_tf')
        self.broadcaster = TransformBroadcaster(self)
        self._warned_stale_stamp = False
        self.subscription = self.create_subscription(
            Odometry, '/odom', self.on_odom, 10)

    def on_odom(self, odom):
        transform = TransformStamped()
        transform.header = odom.header
        # The LiDAR stamps scans with the Pi's ROS clock. If the ESP32/agent
        # clock drifts, forwarding the stale odometry stamp makes TF unavailable
        # at scan time and SLAM silently stops accepting scans. Keep accurate
        # source stamps, but recover from a clearly unsynchronized clock.
        now = self.get_clock().now()
        odom_stamp_ns = (
            int(odom.header.stamp.sec) * 1_000_000_000
            + int(odom.header.stamp.nanosec)
        )
        if odom_stamp_ns == 0 or abs(now.nanoseconds - odom_stamp_ns) > 250_000_000:
            transform.header.stamp = now.to_msg()
            if not self._warned_stale_stamp:
                skew_sec = (now.nanoseconds - odom_stamp_ns) / 1_000_000_000.0
                self.get_logger().warning(
                    f'/odom timestamp differs from Pi clock by {skew_sec:.3f}s; '
                    'restamping odom->base_link TF with Pi time. '
                    'Synchronize/reflash the ESP32 firmware to fix the source clock.'
                )
                self._warned_stale_stamp = True
        transform.child_frame_id = odom.child_frame_id or 'base_link'
        transform.transform.translation.x = odom.pose.pose.position.x
        transform.transform.translation.y = odom.pose.pose.position.y
        transform.transform.translation.z = odom.pose.pose.position.z
        transform.transform.rotation = odom.pose.pose.orientation
        self.broadcaster.sendTransform(transform)


def main():
    rclpy.init()
    node = OdomToTf()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
