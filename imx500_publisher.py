# #!/usr/bin/env python3
# import time
# import cv2
# import roslibpy
# from picamera2 import Picamera2, Preview, MappedArray
# from picamera2.devices import IMX500

# MODEL_PATH = "/usr/share/imx500-models/imx500_network_ssd_mobilenetv2_fpnlite_320x320_pp.rpk"
# ROSBRIDGE_HOST = "localhost"
# ROSBRIDGE_PORT = 9090
# CONF_THRESHOLD = 0.5

# # --- เชื่อมต่อ rosbridge ---
# client = roslibpy.Ros(host=ROSBRIDGE_HOST, port=ROSBRIDGE_PORT)
# client.run()

# detections_topic = roslibpy.Topic(
#     client, '/camera/detections', 'vision_msgs/Detection2DArray'
# )

# # --- เริ่มกล้อง + โหลดโมเดลลง IMX500 ---
# imx500 = IMX500(MODEL_PATH)
# intrinsics = imx500.network_intrinsics
# labels = intrinsics.labels if intrinsics and intrinsics.labels else []

# picam2 = Picamera2(imx500.camera_num)
# config = picam2.create_preview_configuration(controls={"FrameRate": 30})

# # เก็บผลตรวจจับล่าสุดไว้ให้ pre_callback ใช้วาด (อัปเดตใน loop หลัก)
# last_detections = []

# def draw_overlay(request):
#     """วาดกรอบ + label ทับเฟรมก่อนแสดงผลบน preview"""
#     with MappedArray(request, "main") as m:
#         h, w = m.array.shape[:2]
#         for det in last_detections:
#             x, y, bw, bh, label, score = det
#             x0, y0 = int(x * w), int(y * h)
#             x1, y1 = int((x + bw) * w), int((y + bh) * h)
#             cv2.rectangle(m.array, (x0, y0), (x1, y1), (0, 255, 0), 2)
#             text = f"{label} {score:.2f}"
#             cv2.putText(m.array, text, (x0, max(y0 - 8, 0)),
#                         cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

# picam2.pre_callback = draw_overlay

# #picam2.start_preview(Preview.QTGL, x=100, y=100, width=800, height=600)
# picam2.start_preview(Preview.NULL)
# picam2.start(config)

# print("Publisher เริ่มทำงาน (พร้อม preview + object detection)... กด Ctrl+C เพื่อหยุด")

# try:
#     while True:
#         metadata = picam2.capture_metadata()
#         outputs = imx500.get_outputs(metadata, add_batch=True)

#         current_detections = []
#         detection_list = []

#         if outputs is not None:
#             boxes, scores, classes = outputs[0][0], outputs[1][0], outputs[2][0]

#             for box, score, cls in zip(boxes, scores, classes):
#                 if score < CONF_THRESHOLD:
#                     continue

#                 x, y, w, h = [float(v) for v in box]
#                 label = labels[int(cls)] if labels and int(cls) < len(labels) else str(int(cls))

#                 # เก็บไว้ให้ overlay วาด (normalized 0-1)
#                 current_detections.append((x, y, w, h, label, float(score)))

#                 # เตรียม ROS message
#                 detection_list.append({
#                     "results": [{
#                         "hypothesis": {"class_id": label, "score": float(score)},
#                         "pose": {"pose": {"position": {"x": 0.0, "y": 0.0, "z": 0.0},
#                                            "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}},
#                                  "covariance": [0.0] * 36}
#                     }],
#                     "bbox": {
#                         "center": {"position": {"x": x + w / 2, "y": y + h / 2}, "theta": 0.0},
#                         "size_x": w,
#                         "size_y": h
#                     },
#                     "id": label
#                 })

#         last_detections = current_detections  # ให้ pre_callback ใช้เฟรมถัดไป

#         msg = {
#             "header": {"stamp": {"sec": 0, "nanosec": 0}, "frame_id": "camera"},
#             "detections": detection_list
#         }
#         detections_topic.publish(roslibpy.Message(msg))

#         time.sleep(1 / 12)  # ~12fps

# except KeyboardInterrupt:
#     print("\nกำลังหยุด...")

# finally:
#     picam2.stop()
#     detections_topic.unadvertise()
#     client.terminate()
#!/usr/bin/env python3

import time
import cv2
import roslibpy

from picamera2 import Picamera2, Preview, MappedArray
from picamera2.devices import IMX500


# ============================================================
# CONFIG
# ============================================================

MODEL_PATH = (
    "/usr/share/imx500-models/"
    "imx500_network_ssd_mobilenetv2_fpnlite_320x320_pp.rpk"
)

ROSBRIDGE_HOST = "localhost"
ROSBRIDGE_PORT = 9090

# ------------------------------------------------------------
# Detection
# ------------------------------------------------------------

CONF_THRESHOLD = 0.55

# ถ้าต้องการตรวจละเอียดขึ้นในอนาคต
# สามารถลดเป็น 0.45 ได้
#
# 0.55 = ค่อนข้าง conservative
# 0.45 = ตรวจคนได้ไวขึ้น แต่ false positive อาจเพิ่ม


# ------------------------------------------------------------
# Safety
# ------------------------------------------------------------

# จำนวน frame ที่ต้องเจอคนต่อเนื่องก่อน STOP
PERSON_CONFIRM_FRAMES = 3

# จำนวน frame ที่ไม่เจอคนต่อเนื่องก่อน CLEAR
PERSON_CLEAR_FRAMES = 8


# ------------------------------------------------------------
# Forward Safety Zone
#
# normalized coordinate
#
# x: 0 -> 1
# y: 0 -> 1
#
# ตัวอย่าง:
#
# 0.20 ---------------- 0.80
#       SAFETY ZONE
# 0.35 ---------------- 0.85
# ------------------------------------------------------------

SAFETY_X_MIN = 0.20
SAFETY_X_MAX = 0.80

SAFETY_Y_MIN = 0.25
SAFETY_Y_MAX = 0.90


# ------------------------------------------------------------
# Close Person Detection
#
# bbox height มากกว่าค่านี้
# ถือว่าคนอยู่ใกล้กล้องมาก
# ------------------------------------------------------------

CLOSE_PERSON_HEIGHT = 0.35


# ------------------------------------------------------------
# Detection loop
# ------------------------------------------------------------

PROCESS_FPS = 15.0


# ============================================================
# ROSBRIDGE
# ============================================================

client = roslibpy.Ros(
    host=ROSBRIDGE_HOST,
    port=ROSBRIDGE_PORT
)

client.run()

print("ROSBridge connected")


# ============================================================
# DETECTION TOPIC
# ============================================================

detections_topic = roslibpy.Topic(
    client,
    "/camera/detections",
    "vision_msgs/Detection2DArray"
)


# ============================================================
# SAFETY TOPIC
#
# true  = ต้องหยุด
# false = clear
# ============================================================

safety_topic = roslibpy.Topic(
    client,
    "/safety/person_stop",
    "std_msgs/Bool"
)


# ============================================================
# LOAD IMX500
# ============================================================

print("Loading IMX500 model...")

imx500 = IMX500(MODEL_PATH)

intrinsics = imx500.network_intrinsics

labels = (
    intrinsics.labels
    if intrinsics and intrinsics.labels
    else []
)

print("Labels:", labels)


# ============================================================
# CAMERA
# ============================================================

picam2 = Picamera2(imx500.camera_num)

config = picam2.create_preview_configuration(
    controls={
        "FrameRate": 30
    }
)


# ============================================================
# GLOBAL DETECTION DATA
# ============================================================

last_detections = []

# คนที่อยู่ใน safety zone
person_in_zone = False

# safety state
person_stop = False

# frame counters
person_confirm_count = 0
person_clear_count = 0


# ============================================================
# HELPER
# ============================================================

def clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


def is_inside_safety_zone(x, y, w, h):
    """
    ตรวจว่ากรอบคนอยู่ในพื้นที่ด้านหน้าหุ่นหรือไม่
    """

    center_x = x + (w / 2)
    center_y = y + (h / 2)

    # center ของคนอยู่ใน safety zone
    center_inside = (
        SAFETY_X_MIN
        <= center_x
        <= SAFETY_X_MAX
        and
        SAFETY_Y_MIN
        <= center_y
        <= SAFETY_Y_MAX
    )

    # bbox มีการ overlap กับ safety zone
    box_left = x
    box_right = x + w
    box_top = y
    box_bottom = y + h

    overlap_x = (
        box_right >= SAFETY_X_MIN
        and box_left <= SAFETY_X_MAX
    )

    overlap_y = (
        box_bottom >= SAFETY_Y_MIN
        and box_top <= SAFETY_Y_MAX
    )

    overlap = overlap_x and overlap_y

    return center_inside or overlap


def is_person_close(w, h):
    """
    ใช้ bbox height เป็นตัวประมาณระยะ
    """

    return h >= CLOSE_PERSON_HEIGHT


# ============================================================
# DRAW OVERLAY
# ============================================================

def draw_overlay(request):

    with MappedArray(request, "main") as m:

        image = m.array

        height, width = image.shape[:2]

        # ----------------------------------------------------
        # Draw Safety Zone
        # ----------------------------------------------------

        x0 = int(SAFETY_X_MIN * width)
        x1 = int(SAFETY_X_MAX * width)

        y0 = int(SAFETY_Y_MIN * height)
        y1 = int(SAFETY_Y_MAX * height)

        if person_stop:
            zone_color = (0, 0, 255)
        else:
            zone_color = (0, 255, 255)

        cv2.rectangle(
            image,
            (x0, y0),
            (x1, y1),
            zone_color,
            2
        )

        # ----------------------------------------------------
        # Draw detection boxes
        # ----------------------------------------------------

        for det in last_detections:

            x, y, bw, bh, label, score, danger = det

            px0 = int(x * width)
            py0 = int(y * height)

            px1 = int((x + bw) * width)
            py1 = int((y + bh) * height)

            # ------------------------------------------------
            # Color
            # ------------------------------------------------

            if danger:
                color = (0, 0, 255)
            else:
                color = (0, 255, 0)

            cv2.rectangle(
                image,
                (px0, py0),
                (px1, py1),
                color,
                2
            )

            # ------------------------------------------------
            # Label
            # ------------------------------------------------

            text = (
                f"{label} "
                f"{score:.2f}"
            )

            if danger:
                text += " STOP"

            cv2.putText(
                image,
                text,
                (px0, max(py0 - 8, 0)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2
            )

        # ----------------------------------------------------
        # Safety status
        # ----------------------------------------------------

        if person_stop:

            status_text = "PERSON DETECTED - STOP"

            status_color = (0, 0, 255)

        else:

            status_text = "PATH CLEAR"

            status_color = (0, 255, 0)

        cv2.putText(
            image,
            status_text,
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            status_color,
            2
        )


# ============================================================
# CAMERA CALLBACK
# ============================================================

picam2.pre_callback = draw_overlay


# ============================================================
# START CAMERA
# ============================================================

picam2.start_preview(Preview.NULL)

picam2.start(config)

print(
    "IMX500 Person Safety started"
)

print(
    "Model:",
    MODEL_PATH
)

print(
    "Confidence threshold:",
    CONF_THRESHOLD
)

print(
    "Safety zone:",
    SAFETY_X_MIN,
    SAFETY_X_MAX,
    SAFETY_Y_MIN,
    SAFETY_Y_MAX
)


# ============================================================
# MAIN LOOP
# ============================================================

try:

    while True:

        # ----------------------------------------------------
        # Capture metadata
        # ----------------------------------------------------

        metadata = picam2.capture_metadata()

        # ----------------------------------------------------
        # Get IMX500 outputs
        # ----------------------------------------------------

        outputs = imx500.get_outputs(
            metadata,
            add_batch=True
        )

        current_detections = []

        detection_list = []

        detected_dangerous_person = False

        # ----------------------------------------------------
        # Parse detection
        # ----------------------------------------------------

        if outputs is not None:

            boxes = outputs[0][0]
            scores = outputs[1][0]
            classes = outputs[2][0]

            for box, score, cls in zip(
                boxes,
                scores,
                classes
            ):

                score = float(score)

                # --------------------------------------------
                # Confidence filter
                # --------------------------------------------

                if score < CONF_THRESHOLD:
                    continue

                # --------------------------------------------
                # Bounding box
                # --------------------------------------------

                x, y, w, h = [
                    float(v)
                    for v in box
                ]

                # ป้องกันค่าหลุด
                x = clamp(x, 0.0, 1.0)
                y = clamp(y, 0.0, 1.0)

                w = clamp(
                    w,
                    0.0,
                    1.0 - x
                )

                h = clamp(
                    h,
                    0.0,
                    1.0 - y
                )

                class_index = int(cls)

                # --------------------------------------------
                # Label
                # --------------------------------------------

                if (
                    labels
                    and class_index < len(labels)
                ):

                    label = labels[class_index]

                else:

                    label = str(class_index)

                label_lower = str(
                    label
                ).lower()

                # --------------------------------------------
                # เราสนใจเฉพาะคน
                # --------------------------------------------

                is_person = (
                    label_lower == "person"
                    or
                    label_lower == "people"
                )

                if not is_person:

                    continue

                # --------------------------------------------
                # Safety zone
                # --------------------------------------------

                inside_zone = is_inside_safety_zone(
                    x,
                    y,
                    w,
                    h
                )

                # --------------------------------------------
                # Close person
                # --------------------------------------------

                close_person = is_person_close(
                    w,
                    h
                )

                # --------------------------------------------
                # Danger decision
                # --------------------------------------------

                danger = (
                    inside_zone
                    or
                    close_person
                )

                if danger:

                    detected_dangerous_person = True

                # --------------------------------------------
                # Save for overlay
                # --------------------------------------------

                current_detections.append(
                    (
                        x,
                        y,
                        w,
                        h,
                        label,
                        score,
                        danger
                    )
                )

                # --------------------------------------------
                # ROS Detection2D
                # --------------------------------------------

                detection_list.append(
                    {
                        "results": [
                            {
                                "hypothesis": {
                                    "class_id": label,
                                    "score": score
                                },

                                "pose": {
                                    "pose": {
                                        "position": {
                                            "x": 0.0,
                                            "y": 0.0,
                                            "z": 0.0
                                        },

                                        "orientation": {
                                            "x": 0.0,
                                            "y": 0.0,
                                            "z": 0.0,
                                            "w": 1.0
                                        }
                                    },

                                    "covariance": [
                                        0.0
                                    ] * 36
                                }
                            }
                        ],

                        "bbox": {
                            "center": {
                                "position": {
                                    "x": x + w / 2,
                                    "y": y + h / 2
                                },

                                "theta": 0.0
                            },

                            "size_x": w,
                            "size_y": h
                        },

                        "id": label
                    }
                )

        # ====================================================
        # TEMPORAL SAFETY FILTER
        # ====================================================

        if detected_dangerous_person:

            person_confirm_count += 1

            person_clear_count = 0

        else:

            person_confirm_count = 0

            person_clear_count += 1

        # ====================================================
        # TRIGGER STOP
        # ====================================================

        if (
            not person_stop
            and
            person_confirm_count
            >= PERSON_CONFIRM_FRAMES
        ):

            person_stop = True

            print(
                "!!! PERSON DETECTED -> STOP !!!"
            )

        # ====================================================
        # RELEASE STOP
        # ====================================================

        if (
            person_stop
            and
            person_clear_count
            >= PERSON_CLEAR_FRAMES
        ):

            person_stop = False

            print(
                "Person clear -> RELEASE"
            )

        # ====================================================
        # SAVE DETECTIONS
        # ====================================================

        last_detections = current_detections

        # ====================================================
        # PUBLISH DETECTION
        # ====================================================

        detection_msg = {
            "header": {
                "stamp": {
                    "sec": 0,
                    "nanosec": 0
                },

                "frame_id": "camera"
            },

            "detections": detection_list
        }

        detections_topic.publish(
            roslibpy.Message(
                detection_msg
            )
        )

        # ====================================================
        # PUBLISH SAFETY STATE
        # ====================================================

        safety_msg = {
            "data": bool(person_stop)
        }

        safety_topic.publish(
            roslibpy.Message(
                safety_msg
            )
        )

        # ====================================================
        # LOOP RATE
        # ====================================================

        time.sleep(
            1.0 / PROCESS_FPS
        )


# ============================================================
# CTRL+C
# ============================================================

except KeyboardInterrupt:

    print(
        "\nกำลังหยุด..."
    )


# ============================================================
# CLEANUP
# ============================================================

finally:

    try:
        picam2.stop()
    except Exception:
        pass

    try:
        detections_topic.unadvertise()
    except Exception:
        pass

    try:
        safety_topic.unadvertise()
    except Exception:
        pass

    try:
        client.terminate()
    except Exception:
        pass

    print(
        "IMX500 Person Safety stopped"
    )