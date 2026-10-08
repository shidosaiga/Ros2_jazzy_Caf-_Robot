#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from nav_msgs.msg import Odometry
from geometry_msgs.msg import TransformStamped
import tf2_ros

class FakeOdom(Node):
    def __init__(self):
        super().__init__('fake_odom')
        self.pub = self.create_publisher(Odometry, '/odom', 10)
        self.br = tf2_ros.TransformBroadcaster(self)
        self.static_br = tf2_ros.StaticTransformBroadcaster(self)

        # publish base_link → laser_frame ครั้งเดียว
        self.publish_static_tf()
        self.create_timer(0.1, self.publish)

    def publish_static_tf(self):
        t = TransformStamped()
        t.header.stamp = self.get_clock().now().to_msg()
        t.header.frame_id = 'base_link'
        t.child_frame_id = 'laser_frame'
        t.transform.translation.z = 0.1
        t.transform.rotation.w = 1.0
        self.static_br.sendTransform(t)
        self.get_logger().info('Published static TF: base_link -> laser_frame')

    def publish(self):
        now = self.get_clock().now().to_msg()

        # Publish odom topic
        odom = Odometry()
        odom.header.stamp = now
        odom.header.frame_id = 'odom'
        odom.child_frame_id = 'base_link'
        odom.pose.pose.orientation.w = 1.0
        self.pub.publish(odom)

        # Publish odom → base_link TF
        t = TransformStamped()
        t.header.stamp = now
        t.header.frame_id = 'odom'
        t.child_frame_id = 'base_link'
        t.transform.rotation.w = 1.0
        self.br.sendTransform(t)

def main():
    rclpy.init()
    rclpy.spin(FakeOdom())

if __name__ == '__main__':
    main()
