FROM ros:jazzy-ros-base

# ติดตั้ง ROS2 packages ทั้งหมด
RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-jazzy-rosbridge-suite \
    ros-jazzy-vision-msgs \
    ros-jazzy-slam-toolbox \
    ros-jazzy-nav2-bringup \
    ros-jazzy-nav2-map-server \
    git \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# build YDLIDAR SDK + ros2 driver จาก source (ยังไม่มี apt package สำเร็จรูปสำหรับ jazzy)
WORKDIR /opt
RUN git clone https://github.com/YDLIDAR/YDLidar-SDK.git && \
    cd YDLidar-SDK/build 2>/dev/null || mkdir -p YDLidar-SDK/build && cd YDLidar-SDK/build && \
    cmake .. && make -j$(nproc) && make install

RUN mkdir -p /ros2_ws/src && cd /ros2_ws/src && \
    git clone https://github.com/YDLIDAR/ydlidar_ros2_driver.git && \
    cd ydlidar_ros2_driver && \
    git fetch origin pull/62/head:pr62 && \
    git checkout pr62 && \
    sed -i -E 's/declare_parameter<bool>\("(m[123]_mode)", false\)/declare_parameter<int>("\1", 0)/' \
        src/ydlidar_ros2_driver_node.cpp

WORKDIR /ros2_ws
RUN /bin/bash -c "source /opt/ros/jazzy/setup.bash && colcon build --symlink-install"

COPY entrypoint.sh /entrypoint.sh
COPY odom_to_tf.py /odom_to_tf.py
COPY motor_test_until_odom.py /motor_test_until_odom.py
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["ros2", "run", "rosbridge_server", "rosbridge_websocket"]
