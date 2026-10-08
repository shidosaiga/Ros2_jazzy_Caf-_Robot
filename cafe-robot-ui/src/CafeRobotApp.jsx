import { useState, useEffect, useRef, useCallback } from "react";
import * as ROSLIB from "roslib";

// ============================================================
// TABLE POSITIONS
// ============================================================

const TABLE_POSITIONS = {
  1: { x: 1.0, y: 2.0, label: "โต๊ะ 1" },
  2: { x: 2.5, y: 2.0, label: "โต๊ะ 2" },
  3: { x: 4.0, y: 2.0, label: "โต๊ะ 3" },
  4: { x: 1.0, y: 0.5, label: "โต๊ะ 4" },
  5: { x: 2.5, y: 0.5, label: "โต๊ะ 5" },
  6: { x: 4.0, y: 0.5, label: "โต๊ะ 6" },
};

const HOME = {
  x: 0.0,
  y: 0.0,
  label: "Home",
};

// ============================================================
// COLORS
// ============================================================

const COLORS = {
  bg: "#0f1117",
  surface: "#1a1d27",
  border: "#2d3148",
  accent: "#2563eb",
  warn: "#f59e0b",
  success: "#22c55e",
  danger: "#ef4444",
  text: "#e8e6e0",
  muted: "#6b7280",
};

// ============================================================
// OBJECT DETECTION COLORS
// ============================================================

const OBJ_COLORS = {
  person: "#ef4444",
  car: "#f59e0b",
  cup: "#22c55e",
  bottle: "#8b5cf6",
  chair: "#06b6d4",
  default: "#2563eb",
};

// ============================================================
// STATUS DOT
// ============================================================

function Dot({ on }) {
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: on ? COLORS.success : COLORS.danger,
        display: "inline-block",
      }}
    />
  );
}

// ============================================================
// MAP CANVAS
// ============================================================

function MapCanvas({ mapData, robotPose, goalPose }) {
  const canvasRef = useRef(null);

  // ----------------------------------------------------------
  // Draw occupancy grid
  // ----------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !mapData) {
      return;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    const {
      width,
      height,
      data,
    } = mapData;

    if (!width || !height || !data) {
      return;
    }

    // Render at map resolution, then scale once. Drawing one rectangle per
    // cell on the visible canvas made each map update expensive on the Pi.
    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = width;
    mapCanvas.height = height;
    const mapCtx = mapCanvas.getContext("2d");
    if (!mapCtx) return;

    const pixels = mapCtx.createImageData(width, height);
    for (let index = 0; index < width * height; index++) {
      const value = Number(data[index]);
      const offset = index * 4;
      if (value < 0) {
        pixels.data[offset] = 30;
        pixels.data[offset + 1] = 32;
        pixels.data[offset + 2] = 48;
      } else if (value === 0) {
        pixels.data[offset] = 209;
        pixels.data[offset + 1] = 213;
        pixels.data[offset + 2] = 219;
      } else {
        pixels.data[offset] = 15;
        pixels.data[offset + 1] = 17;
        pixels.data[offset + 2] = 23;
      }
      pixels.data[offset + 3] = 255;
    }

    mapCtx.putImageData(pixels, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapCanvas, 0, 0, canvas.width, canvas.height);
  }, [mapData]);

  // ----------------------------------------------------------
  // Convert ROS world coordinate -> canvas coordinate
  // ----------------------------------------------------------

  const toPixel = useCallback(
    (worldX, worldY) => {
      if (!mapData || !canvasRef.current) {
        return {
          px: 0,
          py: 0,
        };
      }

      const canvas = canvasRef.current;

      const scaleX = canvas.width / mapData.width;
      const scaleY = canvas.height / mapData.height;

      const px =
        ((worldX - mapData.origin.x) / mapData.resolution) *
        scaleX;

      const py =
        canvas.height -
        ((worldY - mapData.origin.y) / mapData.resolution) *
          scaleY;

      return {
        px,
        py,
      };
    },
    [mapData]
  );

  const robotPx = robotPose
    ? toPixel(robotPose.x, robotPose.y)
    : null;

  const goalPx = goalPose
    ? toPixel(goalPose.x, goalPose.y)
    : null;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <canvas
        ref={canvasRef}
        width={600}
        height={360}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 8,
          display: "block",
          background: "#0f1117",
        }}
      />

      {/* ---------------------------------------------------- */}
      {/* TABLE MARKERS */}
      {/* ---------------------------------------------------- */}

      {Object.entries(TABLE_POSITIONS).map(([id, table]) => {
        const { px, py } = toPixel(table.x, table.y);

        return (
          <div
            key={id}
            style={{
              position: "absolute",
              left: px - 10,
              top: py - 10,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#374151",
              border: "1px solid #9ca3af",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              color: "#e5e7eb",
              fontWeight: 600,
              pointerEvents: "none",
            }}
          >
            {id}
          </div>
        );
      })}

      {/* ---------------------------------------------------- */}
      {/* GOAL */}
      {/* ---------------------------------------------------- */}

      {goalPx && (
        <div
          style={{
            position: "absolute",
            left: goalPx.px - 7,
            top: goalPx.py - 7,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: COLORS.warn,
            border: "2px solid #fff",
            boxShadow: "0 0 10px rgba(245,158,11,0.6)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* ---------------------------------------------------- */}
      {/* ROBOT */}
      {/* ---------------------------------------------------- */}

      {robotPx && (
        <div
          style={{
            position: "absolute",
            left: robotPx.px - 9,
            top: robotPx.py - 9,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: COLORS.accent,
            border: "2px solid #fff",
            boxShadow: "0 0 10px rgba(37,99,235,0.7)",
            transition: "left 0.5s, top 0.5s",
            pointerEvents: "none",
          }}
        />
      )}

      {/* ---------------------------------------------------- */}
      {/* LEGEND */}
      {/* ---------------------------------------------------- */}

      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          display: "flex",
          gap: 12,
          fontSize: 11,
          color: COLORS.muted,
          background: "rgba(15,17,23,0.8)",
          padding: "4px 8px",
          borderRadius: 6,
        }}
      >
        <span>🔵 หุ่น</span>
        <span>🟡 เป้าหมาย</span>
        <span>⚫ ผนัง</span>
      </div>
    </div>
  );
}

// ============================================================
// OBJECT DETECTION
// ============================================================

function DetectionView({ detections }) {
  if (!detections || detections.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 100,
          color: COLORS.muted,
          fontSize: 13,
        }}
      >
        ไม่พบ object...
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      {detections.map((detection, index) => {
        const objectId =
          detection.id || detection.classId || "unknown";

        const color =
          OBJ_COLORS[objectId] || OBJ_COLORS.default;

        const score = Number(detection.score || 0);

        const pct = Math.max(
          0,
          Math.min(100, Math.round(score * 100))
        );

        let icon = "📦";

        if (objectId === "person") {
          icon = "🧑";
        } else if (objectId === "cup") {
          icon = "☕";
        } else if (objectId === "bottle") {
          icon = "🍶";
        } else if (objectId === "car") {
          icon = "🚗";
        } else if (objectId === "chair") {
          icon = "🪑";
        }

        return (
          <div
            key={index}
            style={{
              background: `${color}22`,
              border: `1px solid ${color}88`,
              borderRadius: 10,
              padding: "8px 12px",
              minWidth: 90,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 28,
              }}
            >
              {icon}
            </div>

            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color,
                marginTop: 2,
              }}
            >
              {objectId}
            </div>

            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
              }}
            >
              {pct}%
            </div>

            <div
              style={{
                marginTop: 4,
                height: 3,
                background: COLORS.border,
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function CafeRobotApp() {
  // ----------------------------------------------------------
  // React state
  // ----------------------------------------------------------

  const [ip, setIp] = useState(`${window.location.hostname}:9090`);

  const [connected, setConnected] = useState(false);

  const [robotStatus, setRobotStatus] = useState("idle");

  const [queue, setQueue] = useState([]);

  const [currentGoal, setCurrentGoal] = useState(null);

  const [tableStates, setTableStates] = useState({});

  const [mapData, setMapData] = useState(null);

  const [robotPose, setRobotPose] = useState(null);

  const [detections, setDetections] = useState([]);

  const [logs, setLogs] = useState([
    "รอการเชื่อมต่อ...",
  ]);

  const [orderCount, setOrderCount] = useState(0);

  // ----------------------------------------------------------
  // ROS refs
  // ----------------------------------------------------------

  const rosRef = useRef(null);

  const goalPubRef = useRef(null);

  const mapSubRef = useRef(null);

  const slamPoseSubRef = useRef(null);

  const amclPoseSubRef = useRef(null);

  const detectionSubRef = useRef(null);

  // ----------------------------------------------------------
  // LOG
  // ----------------------------------------------------------

  const addLog = useCallback((message) => {
    const time = new Date().toLocaleTimeString("th-TH");

    setLogs((previous) => [
      `${time} ${message}`,
      ...previous.slice(0, 20),
    ]);
  }, []);

  // ==========================================================
  // SEND GOAL
  // ==========================================================

  const sendGoalToROS = useCallback(
    (position) => {
      if (!goalPubRef.current) {
        addLog("ยังไม่ได้เชื่อมต่อ ROS");
        return false;
      }

      /*
       * IMPORTANT:
       *
       * roslib version ที่ติดตั้งอยู่ไม่มี ROSLIB.Message
       *
       * ดังนั้น publish plain JavaScript object ได้เลย
       */

      const message = {
        header: {
          frame_id: "map",
          stamp: {
            sec: 0,
            nanosec: 0,
          },
        },

        pose: {
          position: {
            x: Number(position.x),
            y: Number(position.y),
            z: 0,
          },

          orientation: {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
          },
        },
      };

      try {
        goalPubRef.current.publish(message);

        addLog(
          `ส่ง Goal x=${Number(position.x).toFixed(
            2
          )}, y=${Number(position.y).toFixed(2)}`
        );

        return true;
      } catch (error) {
        console.error(error);

        addLog("ส่ง Goal ไม่สำเร็จ");

        return false;
      }
    },
    [addLog]
  );

  // ==========================================================
  // START TABLE GOAL
  // ==========================================================

  const startTableGoal = useCallback(
    (tableId, orderNumber = null) => {
      const position = TABLE_POSITIONS[tableId];

      if (!position) {
        addLog(`ไม่พบตำแหน่งโต๊ะ ${tableId}`);
        return false;
      }

      const sent = sendGoalToROS(position);

      if (!sent) {
        return false;
      }

      setCurrentGoal({
        tableId,
        ...position,
      });

      setRobotStatus("moving");

      setTableStates((previous) => ({
        ...previous,
        [tableId]: "active",
      }));

      if (orderNumber !== null) {
        addLog(
          `Order ${orderNumber}: ไปโต๊ะ ${tableId}`
        );
      } else {
        addLog(`กำลังไปโต๊ะ ${tableId}`);
      }

      return true;
    },
    [addLog, sendGoalToROS]
  );

  // ==========================================================
  // CONNECT ROS
  // ==========================================================

  const connect = useCallback(() => {
    // ปิด connection เก่าก่อน
    if (rosRef.current) {
      try {
        rosRef.current.close();
      } catch (error) {
        console.warn(error);
      }

      rosRef.current = null;
    }

    // Clear old subscriptions
    mapSubRef.current = null;
    slamPoseSubRef.current = null;
    amclPoseSubRef.current = null;
    detectionSubRef.current = null;
    goalPubRef.current = null;

    const url = `ws://${ip}`;

    addLog(`กำลังเชื่อมต่อ ${url}`);

    const ros = new ROSLIB.Ros({
      url,
    });

    rosRef.current = ros;

    // --------------------------------------------------------
    // ROS CONNECTION
    // --------------------------------------------------------

    ros.on("connection", () => {
      setConnected(true);

      addLog("เชื่อมต่อ ROS สำเร็จ ✓");

      // ======================================================
      // GOAL PUBLISHER
      // ======================================================

      goalPubRef.current = new ROSLIB.Topic({
        ros,
        name: "/goal_pose",
        messageType: "geometry_msgs/PoseStamped",
      });

      addLog("Publisher /goal_pose (Nav2) พร้อม");

      // ======================================================
      // MAP
      // ======================================================

      const mapTopic = new ROSLIB.Topic({
        ros,
        name: "/map",
        messageType: "nav_msgs/OccupancyGrid",
      });

      mapSubRef.current = mapTopic;

      mapTopic.subscribe((message) => {
        if (!message || !message.info) {
          return;
        }

        setMapData({
          width: Number(message.info.width),
          height: Number(message.info.height),

          data: message.data || [],

          resolution: Number(
            message.info.resolution
          ),

          origin: {
            x: Number(
              message.info.origin?.position?.x || 0
            ),

            y: Number(
              message.info.origin?.position?.y || 0
            ),
          },
        });
      });

      addLog("Subscribe /map ✓");

      // ======================================================
      // MAP-FRAME ROBOT POSE
      // ======================================================

      const updateMapPose = (message) => {
        const position = message?.pose?.pose?.position;
        if (!position) return;
        setRobotPose({
          x: Number(position.x || 0),
          y: Number(position.y || 0),
        });
      };

      // SLAM Toolbox publishes /pose while mapping. Nav2 AMCL publishes
      // /amcl_pose when localizing against a saved map. Both are in map frame.
      const slamPoseTopic = new ROSLIB.Topic({
        ros,
        name: "/pose",
        messageType: "geometry_msgs/PoseWithCovarianceStamped",
      });
      slamPoseSubRef.current = slamPoseTopic;
      slamPoseTopic.subscribe(updateMapPose);

      const amclPoseTopic = new ROSLIB.Topic({
        ros,
        name: "/amcl_pose",
        messageType: "geometry_msgs/PoseWithCovarianceStamped",
      });
      amclPoseSubRef.current = amclPoseTopic;
      amclPoseTopic.subscribe(updateMapPose);

      addLog("Subscribe map pose (/pose, /amcl_pose) ✓");

      // ======================================================
      // OBJECT DETECTION
      // ======================================================

      const detectionTopic = new ROSLIB.Topic({
        ros,
        name: "/camera/detections",
        messageType:
          "vision_msgs/Detection2DArray",
      });

      detectionSubRef.current = detectionTopic;

      detectionTopic.subscribe((message) => {
        const rawDetections =
          message?.detections || [];

        const parsedDetections =
          rawDetections.map((detection) => {
            const result =
              detection?.results?.[0];

            const hypothesis =
              result?.hypothesis;

            return {
              id:
                hypothesis?.class_id ||
                detection?.id ||
                "unknown",

              classId:
                hypothesis?.class_id ||
                "unknown",

              score:
                Number(
                  hypothesis?.score || 0
                ),
            };
          });

        setDetections(parsedDetections);
      });

      addLog(
        "Subscribe /camera/detections ✓"
      );
    });

    // --------------------------------------------------------
    // ROS ERROR
    // --------------------------------------------------------

    ros.on("error", (error) => {
      console.error("ROS error:", error);

      setConnected(false);

      addLog("ROS connection error");
    });

    // --------------------------------------------------------
    // ROS CLOSE
    // --------------------------------------------------------

    ros.on("close", () => {
      setConnected(false);

      goalPubRef.current = null;

      mapSubRef.current = null;
      slamPoseSubRef.current = null;
      amclPoseSubRef.current = null;
      detectionSubRef.current = null;

      addLog("ตัดการเชื่อมต่อ ROS");
    });
  }, [addLog, ip]);

  // ==========================================================
  // DISCONNECT
  // ==========================================================

  const disconnect = useCallback(() => {
    if (rosRef.current) {
      try {
        rosRef.current.close();
      } catch (error) {
        console.warn(error);
      }
    }

    rosRef.current = null;

    goalPubRef.current = null;
    mapSubRef.current = null;
    slamPoseSubRef.current = null;
    amclPoseSubRef.current = null;
    detectionSubRef.current = null;

    setConnected(false);

    addLog("ตัดการเชื่อมต่อแล้ว");
  }, [addLog]);

  // ==========================================================
  // ADD TABLE
  // ==========================================================

  const addTable = useCallback(
    (tableId) => {
      const currentState =
        tableStates[tableId] || "";

      // ไม่ให้โต๊ะเดียวกันถูกเพิ่มซ้ำ
      if (
        currentState === "queued" ||
        currentState === "active"
      ) {
        return;
      }

      const newOrder = orderCount + 1;

      setOrderCount(newOrder);

      // ------------------------------------------------------
      // ถ้าหุ่นยังว่าง -> ไปทันที
      // ------------------------------------------------------

      if (!currentGoal) {
        const success = startTableGoal(
          tableId,
          newOrder
        );

        if (!success) {
          setOrderCount(orderCount);
        }

        return;
      }

      // ------------------------------------------------------
      // ถ้าหุ่นกำลังเดิน -> เข้า Queue
      // ------------------------------------------------------

      setQueue((previous) => [
        ...previous,
        {
          order: newOrder,
          tableId,
        },
      ]);

      setTableStates((previous) => ({
        ...previous,
        [tableId]: "queued",
      }));

      addLog(
        `Order ${newOrder}: เพิ่มโต๊ะ ${tableId} เข้า Queue`
      );
    },
    [
      addLog,
      currentGoal,
      orderCount,
      startTableGoal,
      tableStates,
    ]
  );

  // ==========================================================
  // MARK ARRIVED
  // ==========================================================

  const markArrived = useCallback(() => {
    if (!currentGoal) {
      return;
    }

    const finishedTable =
      currentGoal.tableId;

    // --------------------------------------------------------
    // Mark current table done
    // --------------------------------------------------------

    setTableStates((previous) => ({
      ...previous,
      [finishedTable]: "done",
    }));

    addLog(
      `ถึงโต๊ะ ${finishedTable} ✓`
    );

    setCurrentGoal(null);

    // --------------------------------------------------------
    // Clear "done" status after 3 sec
    // --------------------------------------------------------

    setTimeout(() => {
      setTableStates((previous) => ({
        ...previous,
        [finishedTable]: "",
      }));
    }, 3000);

    // --------------------------------------------------------
    // Start next queue item
    // --------------------------------------------------------

    setQueue((previous) => {
      if (previous.length === 0) {
        setRobotStatus("idle");

        addLog("Queue ว่าง — หยุดรอคำสั่ง");

        return [];
      }

      const next = previous[0];

      const remaining = previous.slice(1);

      setTimeout(() => {
        startTableGoal(
          next.tableId,
          next.order
        );
      }, 0);

      return remaining;
    });
  }, [addLog, currentGoal, startTableGoal]);

  // ==========================================================
  // CANCEL QUEUE ITEM
  // ==========================================================

  const cancelQueueItem = useCallback(
    (index, tableId) => {
      setQueue((previous) =>
        previous.filter(
          (_, itemIndex) => itemIndex !== index
        )
      );

      setTableStates((previous) => ({
        ...previous,
        [tableId]: "",
      }));

      addLog(
        `ยกเลิก Order โต๊ะ ${tableId}`
      );
    },
    [addLog]
  );

  // ==========================================================
  // GO HOME
  // ==========================================================

  const goHome = useCallback(() => {
    // Clear queue
    setQueue([]);

    // Clear table state
    setTableStates({});

    // Clear current goal
    setCurrentGoal(null);

    // Send home goal
    const success = sendGoalToROS(HOME);

    if (success) {
      setRobotStatus("moving");

      addLog("ส่งหุ่นกลับ Home 🏠");
    } else {
      setRobotStatus("idle");

      addLog(
        "ไม่สามารถส่งหุ่นกลับ Home ได้"
      );
    }
  }, [addLog, sendGoalToROS]);

  // ==========================================================
  // CLEANUP WHEN COMPONENT UNMOUNTS
  // ==========================================================

  useEffect(() => {
    return () => {
      if (rosRef.current) {
        try {
          rosRef.current.close();
        } catch (error) {
          console.warn(error);
        }
      }
    };
  }, []);

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily:
          "'Inter', system-ui, sans-serif",
        padding: "1.25rem",
        boxSizing: "border-box",
      }}
    >
      {/* ==================================================== */}
      {/* HEADER */}
      {/* ==================================================== */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          🤖 Café Robot Control
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: COLORS.muted,
          }}
        >
          <Dot on={connected} />

          {connected
            ? "เชื่อมต่อแล้ว"
            : "ไม่ได้เชื่อมต่อ"}
        </span>
      </div>

      {/* ==================================================== */}
      {/* CONNECTION */}
      {/* ==================================================== */}

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: "1rem",
        }}
      >
        <input
          value={ip}
          onChange={(event) =>
            setIp(event.target.value)
          }
          placeholder="robot-host:9090"
          style={{
            flex: 1,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: "8px 12px",
            color: COLORS.text,
            fontSize: 13,
            outline: "none",
          }}
        />

        <button
          onClick={
            connected ? disconnect : connect
          }
          style={{
            background: connected
              ? "#374151"
              : COLORS.accent,
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {connected
            ? "ตัดการเชื่อมต่อ"
            : "เชื่อมต่อ"}
        </button>
      </div>

      {/* ==================================================== */}
      {/* STATUS BAR */}
      {/* ==================================================== */}

      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: "1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {currentGoal
            ? `🚀 กำลังไปโต๊ะ ${currentGoal.tableId}`
            : "⏸ รอคำสั่ง"}
        </span>

        <span
          style={{
            padding: "3px 10px",
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 500,
            background:
              robotStatus === "moving"
                ? "#1e3a5f"
                : "#052e16",
            color:
              robotStatus === "moving"
                ? "#60a5fa"
                : "#4ade80",
          }}
        >
          {robotStatus === "moving"
            ? "กำลังเดิน"
            : "หยุด"}
        </span>
      </div>

      {/* ==================================================== */}
      {/* MAIN LAYOUT */}
      {/* ==================================================== */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1.4fr) minmax(300px, 1fr)",
          gap: "1rem",
        }}
      >
        {/* ================================================== */}
        {/* LEFT COLUMN */}
        {/* ================================================== */}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          {/* ================================================ */}
          {/* MAP */}
          {/* ================================================ */}

          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "1rem",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                marginBottom: 8,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              แผนที่ Realtime
            </div>

            <div
              style={{
                height: 340,
              }}
            >
              <MapCanvas
                mapData={mapData}
                robotPose={robotPose}
                goalPose={currentGoal}
              />
            </div>
          </div>

          {/* ================================================ */}
          {/* CAMERA */}
          {/* ================================================ */}

          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "1rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: COLORS.muted,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                กล้อง Pi AI — Object Detection
              </div>

              <span
                style={{
                  fontSize: 11,
                  background:
                    detections.length > 0
                      ? "#052e16"
                      : "#1a1d27",
                  color:
                    detections.length > 0
                      ? "#4ade80"
                      : COLORS.muted,
                  padding: "2px 8px",
                  borderRadius: 10,
                }}
              >
                {detections.length > 0
                  ? `พบ ${detections.length} object`
                  : "ไม่พบ object"}
              </span>
            </div>

            <DetectionView
              detections={detections}
            />
          </div>
        </div>

        {/* ================================================== */}
        {/* RIGHT COLUMN */}
        {/* ================================================== */}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          {/* ================================================ */}
          {/* TABLE BUTTONS */}
          {/* ================================================ */}

          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "1rem",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                marginBottom: 10,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              เลือกโต๊ะ
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, 1fr)",
                gap: 10,
              }}
            >
              {Object.entries(
                TABLE_POSITIONS
              ).map(([id]) => {
                const tableId = Number(id);

                const state =
                  tableStates[tableId] || "";

                let borderColor =
                  COLORS.border;

                let background =
                  "#252836";

                let numberColor =
                  COLORS.text;

                let statusText = "ว่าง";

                if (state === "active") {
                  borderColor =
                    COLORS.accent;

                  background =
                    "#1e3a5f";

                  numberColor =
                    "#60a5fa";

                  statusText =
                    "กำลังไป";
                }

                if (state === "queued") {
                  borderColor =
                    COLORS.warn;

                  background =
                    "#3d2c05";

                  numberColor =
                    "#fbbf24";

                  statusText =
                    "รอคิว";
                }

                if (state === "done") {
                  borderColor =
                    COLORS.success;

                  background =
                    "#052e16";

                  numberColor =
                    "#4ade80";

                  statusText =
                    "ส่งแล้ว";
                }

                return (
                  <button
                    key={id}
                    onClick={() =>
                      addTable(tableId)
                    }
                    style={{
                      aspectRatio: "1",
                      borderRadius: "50%",
                      border: `2px solid ${borderColor}`,
                      background,
                      cursor:
                        state === "active" ||
                        state === "queued"
                          ? "not-allowed"
                          : "pointer",
                      display: "flex",
                      flexDirection:
                        "column",
                      alignItems: "center",
                      justifyContent:
                        "center",
                      gap: 2,
                      opacity:
                        state === "active" ||
                        state === "queued"
                          ? 0.8
                          : 1,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 24,
                        fontWeight: 600,
                        color: numberColor,
                      }}
                    >
                      {id}
                    </span>

                    <span
                      style={{
                        fontSize: 10,
                        color: COLORS.muted,
                      }}
                    >
                      {statusText}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ================================================ */}
          {/* QUEUE */}
          {/* ================================================ */}

          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "1rem",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                marginBottom: 10,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Queue{" "}
              {currentGoal || queue.length > 0
                ? `(${
                    (currentGoal ? 1 : 0) +
                    queue.length
                  })`
                : ""}
            </div>

            {/* CURRENT GOAL */}

            {currentGoal && (
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "#1e3a5f",
                  borderRadius: 8,
                  marginBottom: 6,
                  border: `1px solid ${COLORS.accent}`,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                  }}
                >
                  🚀{" "}
                  <b>
                    โต๊ะ{" "}
                    {currentGoal.tableId}
                  </b>
                </span>

                <button
                  onClick={markArrived}
                  style={{
                    background:
                      COLORS.success,
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                    color: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ถึงแล้ว ✓
                </button>
              </div>
            )}

            {/* QUEUED ORDERS */}

            {queue.map((item, index) => (
              <div
                key={item.order}
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "#252836",
                  borderRadius: 8,
                  marginBottom: 6,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                  }}
                >
                  ⏳ Order {item.order}: โต๊ะ{" "}
                  {item.tableId}
                </span>

                <button
                  onClick={() =>
                    cancelQueueItem(
                      index,
                      item.tableId
                    )
                  }
                  style={{
                    background: "#374151",
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                    color: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ยกเลิก
                </button>
              </div>
            ))}

            {/* EMPTY QUEUE */}

            {!currentGoal &&
              queue.length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "12px",
                    fontSize: 12,
                    color: "#4b5563",
                  }}
                >
                  ไม่มี order ในคิว
                </div>
              )}

            {/* HOME BUTTON */}

            <button
              onClick={goHome}
              style={{
                width: "100%",
                marginTop: 8,
                padding: "10px",
                background: "#1a1d27",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              🏠 กลับ Home / ยกเลิกทั้งหมด
            </button>
          </div>

          {/* ================================================ */}
          {/* LOG */}
          {/* ================================================ */}

          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "1rem",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                marginBottom: 8,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Log
            </div>

            <div
              style={{
                background: "#0d0f18",
                borderRadius: 8,
                padding: "8px 10px",
                fontFamily: "monospace",
                fontSize: 11,
                color: "#6b7280",
                maxHeight: 120,
                overflowY: "auto",
              }}
            >
              {logs.map((log, index) => (
                <div key={index}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
