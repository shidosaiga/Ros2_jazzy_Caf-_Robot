import { useState, useEffect, useRef, useCallback } from "react";
import * as ROSLIB from "roslib";

// ============================================================
// TABLE POSITIONS
// ============================================================

const TABLE_IDS = [1, 2, 3, 4, 5, 6];
const TABLE_POSITIONS_STORAGE_KEY = "cafe-robot-table-positions-v2";
const LEGACY_TABLE_POSITIONS_STORAGE_KEY = "cafe-robot-table-positions-v1";

const HOME = {
  x: 0.0,
  y: 0.0,
  label: "Home",
};

const JOG_DURATION_MS = 1500;
const JOG_PUBLISH_PERIOD_MS = 100;
const JOG_STRENGTH_LEVELS = [1, 1.5, 2, 2.5, 4, 5];

const quaternionToYaw = (orientation) => {
  if (!orientation) return 0;
  const { x = 0, y = 0, z = 0, w = 1 } = orientation;
  return Math.atan2(
    2 * (w * z + x * y),
    1 - 2 * (y * y + z * z)
  );
};

const getMapViewGeometry = (viewWidth, viewHeight, mapWidth, mapHeight) => {
  const scale = Math.min(viewWidth / mapWidth, viewHeight / mapHeight);
  const width = mapWidth * scale;
  const height = mapHeight * scale;
  return {
    scale,
    width,
    height,
    offsetX: (viewWidth - width) / 2,
    offsetY: (viewHeight - height) / 2,
  };
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

const manualJogButtonStyle = (background, disabled) => ({
  minHeight: 48,
  padding: "8px 6px",
  background,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.45 : 1,
  touchAction: "manipulation",
});

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

function MapCanvas({
  mapData,
  robotPose,
  goalPose,
  tables,
  selectedTableToPlace,
  onMapClick,
}) {
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

    // Render at map resolution, then scale once. OccupancyGrid rows start at
    // the map's bottom edge; canvas rows start at the top, so reverse Y here.
    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = width;
    mapCanvas.height = height;
    const mapCtx = mapCanvas.getContext("2d");
    if (!mapCtx) return;

    const pixels = mapCtx.createImageData(width, height);
    for (let index = 0; index < width * height; index++) {
      const value = Number(data[index]);
      const cellX = index % width;
      const cellY = Math.floor(index / width);
      const canvasY = height - 1 - cellY;
      const offset = (canvasY * width + cellX) * 4;
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
    const view = getMapViewGeometry(canvas.width, canvas.height, width, height);
    ctx.drawImage(mapCanvas, view.offsetX, view.offsetY, view.width, view.height);
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

      const view = getMapViewGeometry(
        canvas.width,
        canvas.height,
        mapData.width,
        mapData.height
      );

      const px = view.offsetX +
        ((worldX - mapData.origin.x) / mapData.resolution) * view.scale;

      const py = view.offsetY + view.height -
        ((worldY - mapData.origin.y) / mapData.resolution) * view.scale;

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

  const handleMapClick = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!mapData || !canvas || !onMapClick) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const view = getMapViewGeometry(
      canvas.width,
      canvas.height,
      mapData.width,
      mapData.height
    );
    const gridX = (canvasX - view.offsetX) / view.scale;
    const gridY = (canvasY - view.offsetY) / view.scale;
    if (gridX < 0 || gridX > mapData.width || gridY < 0 || gridY > mapData.height) return;

    const x = mapData.origin.x + gridX * mapData.resolution;
    const y = mapData.origin.y + (mapData.height - gridY) * mapData.resolution;

    onMapClick({ x, y });
  }, [mapData, onMapClick]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        cursor: selectedTableToPlace ? "crosshair" : "default",
      }}
      onClick={handleMapClick}
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

      {mapData && Object.entries(tables).map(([id, table]) => {
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
              outline: Number(id) === selectedTableToPlace ? `2px solid ${COLORS.warn}` : "none",
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
          title="ตำแหน่งและทิศทางหุ่นจาก /pose หรือ /amcl_pose"
          style={{
            position: "absolute",
            left: robotPx.px - 11,
            top: robotPx.py - 11,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: COLORS.accent,
            border: "2px solid #fff",
            boxShadow: "0 0 10px rgba(37,99,235,0.7)",
            transition: "left 0.5s, top 0.5s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              color: "#fff",
              fontSize: 12,
              lineHeight: 1,
              transform: `rotate(${90 - (robotPose.yaw * 180) / Math.PI}deg)`,
            }}
          >
            ▲
          </span>
        </div>
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

function ImuPanel({ imuData, imuFresh, imuStatusText }) {
  const metrics = [
    ["Accel X", imuData?.acceleration.x, "m/s²"],
    ["Accel Y", imuData?.acceleration.y, "m/s²"],
    ["Accel Z", imuData?.acceleration.z, "m/s²"],
    ["Gyro X", imuData?.angularVelocity.x, "rad/s"],
    ["Gyro Y", imuData?.angularVelocity.y, "rad/s"],
    ["Gyro Z", imuData?.angularVelocity.z, "rad/s"],
  ];

  return (
    <div
      className="panel imu-panel"
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
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
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
          IMU · /imu/data_raw
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: imuFresh ? "#4ade80" : COLORS.warn,
          }}
        >
          <Dot on={imuFresh} /> {imuStatusText}
        </span>
      </div>

      <div className="imu-metrics">
        {metrics.map(([label, value, unit]) => (
          <div className="imu-metric" key={label}>
            <div className="imu-metric-label">{label}</div>
            <div className="imu-metric-value">
              {Number.isFinite(value) ? value.toFixed(2) : "—"}
            </div>
            <div className="imu-metric-unit">{unit}</div>
          </div>
        ))}
      </div>
      <div className="imu-note">
        ค่า IMU ดิบ · ลูกศรหุ่นบนแผนที่ใช้ทิศจาก SLAM/AMCL ไม่ใช่ orientation จาก IMU
      </div>
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

  const [jogActive, setJogActive] = useState(false);

  const [jogMode, setJogMode] = useState(null);

  const [jogStrength, setJogStrength] = useState(1);

  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 });

  const [robotStatus, setRobotStatus] = useState("idle");

  const [queue, setQueue] = useState([]);

  const [currentGoal, setCurrentGoal] = useState(null);

  const [tableStates, setTableStates] = useState({});

  const [tablePositions, setTablePositions] = useState(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(TABLE_POSITIONS_STORAGE_KEY) || "{}"
      );
      return saved && typeof saved === "object" && !Array.isArray(saved)
        ? saved
        : {};
    } catch {
      return {};
    }
  });

  const [tablePlacementMode, setTablePlacementMode] = useState(false);

  const [tableToPlace, setTableToPlace] = useState(null);

  const [mapData, setMapData] = useState(null);

  const [robotPose, setRobotPose] = useState(null);

  const [imuData, setImuData] = useState(null);

  const [imuClock, setImuClock] = useState(Date.now());

  const [detections, setDetections] = useState([]);

  const [logs, setLogs] = useState([
    "รอการเชื่อมต่อ...",
  ]);

  const [orderCount, setOrderCount] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_TABLE_POSITIONS_STORAGE_KEY);
      window.localStorage.setItem(
        TABLE_POSITIONS_STORAGE_KEY,
        JSON.stringify(tablePositions)
      );
    } catch (error) {
      console.warn("Could not save table positions:", error);
    }
  }, [tablePositions]);

  // ----------------------------------------------------------
  // ROS refs
  // ----------------------------------------------------------

  const rosRef = useRef(null);

  const goalPubRef = useRef(null);

  const cmdVelPubRef = useRef(null);

  const jogActiveRef = useRef(false);

  const jogIntervalRef = useRef(null);

  const jogTimeoutRef = useRef(null);

  const jogCommandRef = useRef({ linearX: 0, angularZ: 0 });

  const joystickPadRef = useRef(null);

  const joystickPointerRef = useRef(null);

  const mapSubRef = useRef(null);

  const slamPoseSubRef = useRef(null);

  const amclPoseSubRef = useRef(null);

  const detectionSubRef = useRef(null);

  const imuSubRef = useRef(null);

  const imuLastUiUpdateRef = useRef(0);

  useEffect(() => {
    if (!connected) return undefined;
    const timer = window.setInterval(() => setImuClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [connected]);

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

  const publishTwist = useCallback((linearX, angularZ) => {
    if (!cmdVelPubRef.current) return false;

    try {
      cmdVelPubRef.current.publish({
        linear: { x: linearX, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: angularZ },
      });
      return true;
    } catch (error) {
      console.error("Could not publish /cmd_vel:", error);
      return false;
    }
  }, []);

  const stopJog = useCallback((message = "หยุดมอเตอร์แล้ว") => {
    const wasActive = jogActiveRef.current;

    if (jogIntervalRef.current !== null) {
      window.clearInterval(jogIntervalRef.current);
      jogIntervalRef.current = null;
    }
    if (jogTimeoutRef.current !== null) {
      window.clearTimeout(jogTimeoutRef.current);
      jogTimeoutRef.current = null;
    }

    jogActiveRef.current = false;
    jogCommandRef.current = { linearX: 0, angularZ: 0 };
    joystickPointerRef.current = null;
    setJoystickOffset({ x: 0, y: 0 });
    setJogActive(false);
    setJogMode(null);

    // Send several zero commands; the ESP32 watchdog remains the backup stop.
    if (cmdVelPubRef.current) {
      for (let index = 0; index < 5; index += 1) {
        publishTwist(0, 0);
      }
    }

    if (wasActive && message) addLog(message);
  }, [addLog, publishTwist]);

  const startTimedJog = useCallback((linearX, angularZ, label) => {
    if (!cmdVelPubRef.current) {
      addLog("เชื่อมต่อ ROS ก่อนจึงจะสั่งมอเตอร์ได้");
      return;
    }
    if (currentGoal || robotStatus === "moving") {
      addLog("ยกเลิกหรือจบคำสั่งนำทางก่อนใช้โหมดขับทดสอบ");
      return;
    }
    if (jogActiveRef.current) return;

    jogActiveRef.current = true;
    jogCommandRef.current = { linearX, angularZ };
    setJogActive(true);
    setJogMode("timed");

    if (!publishTwist(linearX, angularZ)) {
      jogActiveRef.current = false;
      setJogActive(false);
      setJogMode(null);
      addLog("ส่งคำสั่ง /cmd_vel ไม่สำเร็จ");
      return;
    }

    jogIntervalRef.current = window.setInterval(() => {
      const command = jogCommandRef.current;
      if (!publishTwist(command.linearX, command.angularZ)) {
        stopJog("การส่งคำสั่งขาดช่วง — ส่งคำสั่งหยุด");
      }
    }, JOG_PUBLISH_PERIOD_MS);

    jogTimeoutRef.current = window.setTimeout(() => {
      stopJog(`${label}: ครบ 1.5 วินาที สั่งหยุดแล้ว`);
    }, JOG_DURATION_MS);

    addLog(`${label}: เริ่มทดสอบ 1.5 วินาที`);
  }, [addLog, currentGoal, publishTwist, robotStatus, stopJog]);

  const startJoystickPublisher = useCallback(() => {
    if (!cmdVelPubRef.current) {
      addLog("เชื่อมต่อ ROS ก่อนจึงจะใช้ joystick ได้");
      return false;
    }
    if (currentGoal || robotStatus === "moving") {
      addLog("จบคำสั่งนำทางก่อนใช้ joystick");
      return false;
    }
    if (jogActiveRef.current) return true;

    jogActiveRef.current = true;
    setJogActive(true);
    const command = jogCommandRef.current;
    if (!publishTwist(command.linearX, command.angularZ)) {
      jogActiveRef.current = false;
      setJogActive(false);
      setJogMode(null);
      addLog("ส่งคำสั่ง /cmd_vel ไม่สำเร็จ");
      return false;
    }

    setJogMode("joystick");

    jogIntervalRef.current = window.setInterval(() => {
      const nextCommand = jogCommandRef.current;
      if (!publishTwist(nextCommand.linearX, nextCommand.angularZ)) {
        stopJog("การส่งคำสั่งขาดช่วง — ส่งคำสั่งหยุด");
      }
    }, JOG_PUBLISH_PERIOD_MS);

    addLog("เริ่มควบคุมด้วย joystick — ปล่อยเพื่อหยุด");
    return true;
  }, [addLog, currentGoal, publishTwist, robotStatus, stopJog]);

  const updateJoystickFromPointer = useCallback((event) => {
    if (joystickPointerRef.current !== event.pointerId) return;
    const pad = joystickPadRef.current;
    if (!pad) return;

    const rect = pad.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxTravel = Math.max(1, Math.min(rect.width, rect.height) / 2 - 28);
    let offsetX = event.clientX - centerX;
    let offsetY = event.clientY - centerY;
    const distance = Math.hypot(offsetX, offsetY);
    if (distance > maxTravel) {
      const scale = maxTravel / distance;
      offsetX *= scale;
      offsetY *= scale;
    }
    setJoystickOffset({ x: offsetX, y: offsetY });

    const normalizeAxis = (value) => {
      const normalized = value / maxTravel;
      const deadzone = 0.12;
      const magnitude = Math.abs(normalized);
      if (magnitude <= deadzone) return 0;
      return Math.sign(normalized) * ((magnitude - deadzone) / (1 - deadzone));
    };
    const linearX = normalizeAxis(-offsetY) * jogStrength * 0.1;
    // ROS angular.z is positive counter-clockwise: drag left = turn left.
    const angularZ = -normalizeAxis(offsetX) * jogStrength;
    jogCommandRef.current = { linearX, angularZ };

    if ((linearX !== 0 || angularZ !== 0) && !jogActiveRef.current) {
      if (!startJoystickPublisher()) {
        joystickPointerRef.current = null;
        setJoystickOffset({ x: 0, y: 0 });
      }
    }
  }, [jogStrength, startJoystickPublisher]);

  const handleJoystickPointerDown = useCallback((event) => {
    if (!connected || currentGoal || robotStatus === "moving" || jogActiveRef.current) {
      return;
    }
    joystickPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystickFromPointer(event);
  }, [connected, currentGoal, robotStatus, updateJoystickFromPointer]);

  const handleJoystickPointerEnd = useCallback((event) => {
    if (joystickPointerRef.current !== event.pointerId) return;
    stopJog("ปล่อย joystick — หยุดมอเตอร์แล้ว");
  }, [stopJog]);

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
      if (jogActiveRef.current) {
        addLog("หยุดโหมดขับทดสอบก่อนส่งเป้าหมายโต๊ะ");
        return false;
      }

      const position = tablePositions[tableId];

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
    [addLog, sendGoalToROS, tablePositions]
  );

  // ==========================================================
  // CONNECT ROS
  // ==========================================================

  const connect = useCallback(() => {
    // ปิด connection เก่าก่อน
    stopJog(null);
    setImuData(null);
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
    imuSubRef.current = null;
    goalPubRef.current = null;
    cmdVelPubRef.current = null;

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

      // Short manual test drive. The ESP32 watchdog stops motors if this
      // publisher disappears or the browser loses its ROS connection.
      cmdVelPubRef.current = new ROSLIB.Topic({
        ros,
        name: "/cmd_vel",
        messageType: "geometry_msgs/Twist",
        queue_size: 1,
      });

      addLog("Publisher /cmd_vel สำหรับขับทดสอบพร้อม");

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
        yaw: quaternionToYaw(message?.pose?.pose?.orientation),
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
      // RAW IMU
      // ======================================================

      const imuTopic = new ROSLIB.Topic({
        ros,
        name: "/imu/data_raw",
        messageType: "sensor_msgs/Imu",
        queue_size: 1,
        throttle_rate: 200,
      });
      imuSubRef.current = imuTopic;
      imuTopic.subscribe((message) => {
        const now = Date.now();
        // Limit dashboard renders to 5 Hz even though the ESP32 publishes at 20 Hz.
        if (now - imuLastUiUpdateRef.current < 200) return;
        imuLastUiUpdateRef.current = now;
        setImuData({
          frameId: message?.header?.frame_id || "imu_link",
          receivedAt: now,
          acceleration: {
            x: Number(message?.linear_acceleration?.x || 0),
            y: Number(message?.linear_acceleration?.y || 0),
            z: Number(message?.linear_acceleration?.z || 0),
          },
          angularVelocity: {
            x: Number(message?.angular_velocity?.x || 0),
            y: Number(message?.angular_velocity?.y || 0),
            z: Number(message?.angular_velocity?.z || 0),
          },
        });
      });
      addLog("Subscribe /imu/data_raw ✓");

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

      if (rosRef.current !== ros) return;

      stopJog(null);
      cmdVelPubRef.current = null;

      setConnected(false);

      addLog("ROS connection error");
    });

    // --------------------------------------------------------
    // ROS CLOSE
    // --------------------------------------------------------

    ros.on("close", () => {
      if (rosRef.current !== ros) return;

      stopJog(null);
      setConnected(false);
      setTablePlacementMode(false);
      setTableToPlace(null);

      goalPubRef.current = null;
      cmdVelPubRef.current = null;

      mapSubRef.current = null;
      slamPoseSubRef.current = null;
      amclPoseSubRef.current = null;
      detectionSubRef.current = null;
      imuSubRef.current = null;

      addLog("ตัดการเชื่อมต่อ ROS");
    });
  }, [addLog, ip, stopJog]);

  // ==========================================================
  // DISCONNECT
  // ==========================================================

  const disconnect = useCallback(() => {
    stopJog(null);
    if (rosRef.current) {
      try {
        rosRef.current.close();
      } catch (error) {
        console.warn(error);
      }
    }

    rosRef.current = null;

    goalPubRef.current = null;
    cmdVelPubRef.current = null;
    mapSubRef.current = null;
    slamPoseSubRef.current = null;
    amclPoseSubRef.current = null;
    detectionSubRef.current = null;
    imuSubRef.current = null;

    setConnected(false);
    setImuData(null);
    setTablePlacementMode(false);
    setTableToPlace(null);

    addLog("ตัดการเชื่อมต่อแล้ว");
  }, [addLog, stopJog]);

  const placeTableOnMap = useCallback((position) => {
    if (!tablePlacementMode || tableToPlace === null) return;

    const tableId = tableToPlace;
    const savedPosition = {
      x: Number(position.x.toFixed(3)),
      y: Number(position.y.toFixed(3)),
      label: `โต๊ะ ${tableId}`,
    };

    setTablePositions((previous) => ({
      ...previous,
      [tableId]: savedPosition,
    }));
    setTableToPlace(null);
    addLog(`กำหนดตำแหน่งโต๊ะ ${tableId} ที่ x=${savedPosition.x}, y=${savedPosition.y}`);
  }, [addLog, tablePlacementMode, tableToPlace]);

  const removeTablePosition = useCallback((tableId) => {
    setTablePositions((previous) => {
      const next = { ...previous };
      delete next[tableId];
      return next;
    });
    if (tableToPlace === tableId) setTableToPlace(null);
    addLog(`ลบตำแหน่งโต๊ะ ${tableId} แล้ว`);
  }, [addLog, tableToPlace]);

  const clearTablePositions = useCallback(() => {
    setTablePositions({});
    setTableToPlace(null);
    setTablePlacementMode(false);
    addLog("ล้างตำแหน่งโต๊ะทั้งหมดแล้ว");
  }, [addLog]);

  // ==========================================================
  // ADD TABLE
  // ==========================================================

  const addTable = useCallback(
    (tableId) => {
      if (jogActiveRef.current) {
        addLog("รอให้โหมดขับทดสอบหยุดก่อนเลือกโต๊ะ");
        return;
      }

      if (!tablePositions[tableId]) {
        addLog(`ยังไม่ได้กำหนดตำแหน่งโต๊ะ ${tableId} บนแผนที่`);
        return;
      }

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
      tablePositions,
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
    if (jogActiveRef.current) {
      addLog("หยุดโหมดขับทดสอบก่อนส่งเป้าหมาย Home");
      return;
    }

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
    const stopWhenWindowLosesFocus = () => {
      if (jogActiveRef.current) {
        stopJog("หน้าเว็บเสีย focus — สั่งหยุดแล้ว");
      }
    };

    window.addEventListener("blur", stopWhenWindowLosesFocus);

    return () => {
      window.removeEventListener("blur", stopWhenWindowLosesFocus);

      if (jogIntervalRef.current !== null) {
        window.clearInterval(jogIntervalRef.current);
      }
      if (jogTimeoutRef.current !== null) {
        window.clearTimeout(jogTimeoutRef.current);
      }
      for (let index = 0; index < 5; index += 1) {
        publishTwist(0, 0);
      }

      if (rosRef.current) {
        try {
          rosRef.current.close();
        } catch (error) {
          console.warn(error);
        }
      }
    };
  }, [publishTwist, stopJog]);

  const jogButtonsDisabled =
    !connected ||
    jogActive ||
    Boolean(currentGoal) ||
    robotStatus === "moving";

  const imuAgeMs = imuData ? Math.max(0, imuClock - imuData.receivedAt) : null;
  const imuFresh = connected && imuAgeMs !== null && imuAgeMs < 1500;
  const imuStatusText = !connected
    ? "ยังไม่เชื่อม ROS"
    : imuData && imuFresh
      ? `รับข้อมูลแล้ว · ${imuData.frameId}`
      : imuData
        ? "ข้อมูลขาดช่วง"
        : "รอข้อมูล IMU";

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div
      className="app-shell"
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
        className="app-header"
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
        className="connection-row"
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
        className="status-bar"
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
        className="main-layout"
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
          className="dashboard-column left-column"
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
            className="panel map-panel"
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
              className="map-view"
              style={{
                height: 340,
              }}
            >
              <MapCanvas
                mapData={mapData}
                robotPose={robotPose}
                goalPose={currentGoal}
                tables={tablePositions}
                selectedTableToPlace={tableToPlace}
                onMapClick={placeTableOnMap}
              />
            </div>
          </div>

          {/* ================================================ */}
          {/* CAMERA */}
          {/* ================================================ */}

          <div
            className="panel camera-panel"
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

          <ImuPanel
            imuData={imuData}
            imuFresh={imuFresh}
            imuStatusText={imuStatusText}
          />

          {/* ================================================ */}
          {/* LOG — stays beside the camera column */}
          {/* ================================================ */}

          <div
            className="panel log-panel"
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

            <div className="log-output">
              {logs.map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </div>
          </div>
        </div>

        {/* ================================================== */}
        {/* RIGHT COLUMN */}
        {/* ================================================== */}

        <div
          className="dashboard-column right-column"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          {/* ================================================ */}
          {/* MANUAL JOG TEST */}
          {/* ================================================ */}

          <div
            className="panel jog-panel"
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
                marginBottom: 6,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              ควบคุมทดสอบ — ไม่ใช้แผนที่
            </div>

            <div
              style={{
                fontSize: 12,
                color: jogActive ? "#fbbf24" : COLORS.muted,
                marginBottom: 12,
              }}
            >
              {jogActive
                ? jogMode === "joystick"
                  ? "กำลังขับด้วย joystick — ปล่อยเพื่อหยุด"
                  : "กำลังขับ — หยุดอัตโนมัติเมื่อครบ 1.5 วินาที"
                : `เดิน/ถอยสูงสุด ${(jogStrength * 0.1).toFixed(2)} m/s · หมุน ${jogStrength.toFixed(1)} rad/s · ปุ่มวิ่ง 1.5 วินาที`}
            </div>

            <div
              role="group"
              aria-label="เลือกระดับความแรง"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 12, color: COLORS.muted, marginRight: 2 }}>
                แรง:
              </span>
              {JOG_STRENGTH_LEVELS.map((level) => {
                const selected = jogStrength === level;
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={jogActive}
                    aria-pressed={selected}
                    onClick={() => setJogStrength(level)}
                    style={{
                      minWidth: 42,
                      padding: "6px 9px",
                      borderRadius: 7,
                      border: `1px solid ${selected ? COLORS.accent : COLORS.border}`,
                      background: selected ? COLORS.accent : "#252836",
                      color: COLORS.text,
                      opacity: jogActive ? 0.5 : 1,
                      cursor: jogActive ? "not-allowed" : "pointer",
                      fontSize: 12,
                    }}
                  >
                    {level}
                  </button>
                );
              })}
            </div>

            <div
              ref={joystickPadRef}
              role="group"
              aria-label="joystick เดินหน้า ถอยหลัง และหมุนซ้ายขวา"
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={updateJoystickFromPointer}
              onPointerUp={handleJoystickPointerEnd}
              onPointerCancel={handleJoystickPointerEnd}
              onLostPointerCapture={handleJoystickPointerEnd}
              style={{
                position: "relative",
                width: 176,
                height: 176,
                maxWidth: "100%",
                margin: "4px auto 14px",
                border: `1px solid ${COLORS.border}`,
                borderRadius: "50%",
                background: "radial-gradient(circle, #242838 0%, #171a24 72%)",
                touchAction: "none",
                userSelect: "none",
                cursor: jogButtonsDisabled ? "not-allowed" : "grab",
                opacity: connected ? 1 : 0.55,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 8,
                  transform: "translateY(-50%)",
                  color: COLORS.muted,
                  fontSize: 11,
                  pointerEvents: "none",
                }}
              >
                ◀ ซ้าย
              </span>
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  right: 8,
                  transform: "translateY(-50%)",
                  color: COLORS.muted,
                  fontSize: 11,
                  pointerEvents: "none",
                }}
              >
                ขวา ▶
              </span>
              <span
                style={{
                  position: "absolute",
                  top: 10,
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  color: COLORS.muted,
                  fontSize: 11,
                  pointerEvents: "none",
                }}
              >
                ▲ หน้า
              </span>
              <span
                style={{
                  position: "absolute",
                  bottom: 10,
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  color: COLORS.muted,
                  fontSize: 11,
                  pointerEvents: "none",
                }}
              >
                ▼ หลัง
              </span>
              <div
                style={{
                  position: "absolute",
                  left: `calc(50% + ${joystickOffset.x}px)`,
                  top: `calc(50% + ${joystickOffset.y}px)`,
                  transform: "translate(-50%, -50%)",
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: `2px solid ${jogActive ? COLORS.warn : COLORS.accent}`,
                  background: jogActive ? "#3d2c05" : "#263b6a",
                  boxShadow: "0 3px 12px rgba(0,0,0,0.4)",
                  pointerEvents: "none",
                }}
              />
            </div>
            <div
              style={{
                marginBottom: 12,
                textAlign: "center",
                color: COLORS.muted,
                fontSize: 11,
              }}
            >
              ลากทุกทิศทางเพื่อเดินและเลี้ยว · ปล่อยเพื่อหยุด
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 8,
                maxWidth: 300,
                margin: "0 auto",
              }}
            >
              <span />
              <button
                type="button"
                disabled={jogButtonsDisabled}
                onClick={() => startTimedJog(jogStrength * 0.1, 0, "เดินหน้า")}
                style={manualJogButtonStyle(COLORS.accent, jogButtonsDisabled)}
                aria-label="เดินหน้า 1.5 วินาที"
              >
                ▲ หน้า
              </button>
              <span />

              <button
                type="button"
                disabled={jogButtonsDisabled}
                onClick={() => startTimedJog(0, jogStrength, "หมุนซ้าย")}
                style={manualJogButtonStyle("#2563eb", jogButtonsDisabled)}
                aria-label="หมุนซ้าย 1.5 วินาที"
              >
                ◀ ซ้าย
              </button>
              <button
                type="button"
                disabled={!connected && !jogActive}
                onClick={() => stopJog("หยุดด้วยปุ่มหยุด")}
                style={manualJogButtonStyle(COLORS.danger, !connected && !jogActive)}
                aria-label="หยุดมอเตอร์"
              >
                ■ หยุด
              </button>
              <button
                type="button"
                disabled={jogButtonsDisabled}
                onClick={() => startTimedJog(0, -jogStrength, "หมุนขวา")}
                style={manualJogButtonStyle("#2563eb", jogButtonsDisabled)}
                aria-label="หมุนขวา 1.5 วินาที"
              >
                ขวา ▶
              </button>

              <span />
              <button
                type="button"
                disabled={jogButtonsDisabled}
                onClick={() => startTimedJog(-jogStrength * 0.1, 0, "ถอยหลัง")}
                style={manualJogButtonStyle("#4b5563", jogButtonsDisabled)}
                aria-label="ถอยหลัง 1.5 วินาที"
              >
                ▼ หลัง
              </button>
              <span />
            </div>

            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                marginTop: 10,
                lineHeight: 1.5,
              }}
            >
              ระดับ 4–5 แรงมาก (สูงสุด 0.40–0.50 m/s) ควรยกล้อพ้นพื้นก่อน · ปุ่มซ้าย/ขวาหมุนอยู่กับที่
            </div>
          </div>

          {/* ================================================ */}
          {/* TABLE BUTTONS */}
          {/* ================================================ */}

          <div
            className="panel tables-panel"
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
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
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
                เลือกโต๊ะ
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  disabled={!connected || !mapData || jogActive}
                  onClick={() => {
                    const nextMode = !tablePlacementMode;
                    setTablePlacementMode(nextMode);
                    setTableToPlace(null);
                    addLog(nextMode
                      ? "โหมดกำหนดโต๊ะ: เลือกหมายเลขโต๊ะ แล้วแตะตำแหน่งบนแผนที่"
                      : "ยกเลิกโหมดกำหนดโต๊ะ");
                  }}
                  style={{
                    minHeight: 40,
                    padding: "6px 10px",
                    border: `1px solid ${tablePlacementMode ? COLORS.warn : COLORS.border}`,
                    borderRadius: 8,
                    background: tablePlacementMode ? "#3d2c05" : "#252836",
                    color: tablePlacementMode ? "#fbbf24" : COLORS.text,
                    cursor: !connected || !mapData || jogActive ? "not-allowed" : "pointer",
                  }}
                >
                  {tablePlacementMode ? "ยกเลิกตั้งโต๊ะ" : "กำหนดตำแหน่งบนแผนที่"}
                </button>
                <button
                  type="button"
                  disabled={Object.keys(tablePositions).length === 0 || jogActive || Boolean(currentGoal) || queue.length > 0}
                  onClick={clearTablePositions}
                  style={{
                    minHeight: 40,
                    padding: "6px 10px",
                    border: "1px solid #7f1d1d",
                    borderRadius: 8,
                    background: "#351b24",
                    color: Object.keys(tablePositions).length === 0 ? COLORS.muted : "#fca5a5",
                    cursor: Object.keys(tablePositions).length === 0 || jogActive || Boolean(currentGoal) || queue.length > 0 ? "not-allowed" : "pointer",
                  }}
                >
                  ล้างทั้งหมด
                </button>
              </div>
            </div>

            <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 10 }}>
              {tablePlacementMode
                ? tableToPlace === null
                  ? "เลือกหมายเลขโต๊ะ แล้วแตะจุดนั้นบนแผนที่"
                  : `เลือกโต๊ะ ${tableToPlace} แล้ว — แตะตำแหน่งบนแผนที่`
                : !connected
                  ? "กดเชื่อมต่อ ROS ก่อน แล้วรอรับแผนที่ /map"
                  : !mapData
                    ? "เชื่อม ROS แล้ว แต่ยังไม่ได้รับ /map จึงยังวางโต๊ะไม่ได้"
                    : jogActive
                      ? "หยุด joystick ก่อนจึงจะกำหนดตำแหน่งโต๊ะได้"
                  : "โต๊ะที่ยังไม่ได้กำหนดตำแหน่งจะไม่แสดงบนแผนที่และสั่งวิ่งไม่ได้"}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, 1fr)",
                gap: 10,
              }}
            >
              {TABLE_IDS.map((tableId) => {
                const id = String(tableId);
                const configured = Boolean(tablePositions[tableId]);
                const selectedForPlacement = tableToPlace === tableId;

                const state =
                  tableStates[tableId] || "";

                let borderColor =
                  COLORS.border;

                let background =
                  "#252836";

                let numberColor =
                  COLORS.text;

                let statusText = configured ? "ว่าง" : "ยังไม่ตั้ง";

                if (selectedForPlacement) {
                  borderColor = COLORS.warn;
                  background = "#3d2c05";
                  numberColor = "#fbbf24";
                  statusText = "เลือกแล้ว";
                }

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
                  <div key={id} style={{ position: "relative", minWidth: 0 }}>
                  <button
                    className="table-button"
                    disabled={jogActive || state === "active" || state === "queued" || (!tablePlacementMode && !configured)}
                    onClick={() => {
                      if (tablePlacementMode) {
                        setTableToPlace(tableId);
                        addLog(`เลือกโต๊ะ ${tableId} — แตะตำแหน่งบนแผนที่`);
                        return;
                      }
                      addTable(tableId);
                    }}
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: "50%",
                      border: `2px solid ${borderColor}`,
                      background,
                      opacity: !configured && !tablePlacementMode ? 0.45 : 1,
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
                  {configured && (
                    <button
                      type="button"
                      className="table-delete-button"
                      disabled={jogActive || state === "active" || state === "queued"}
                      aria-label={`ลบตำแหน่งโต๊ะ ${id}`}
                      title={`ลบตำแหน่งโต๊ะ ${id}`}
                      onClick={() => removeTablePosition(tableId)}
                    >
                      ×
                    </button>
                  )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ================================================ */}
          {/* QUEUE */}
          {/* ================================================ */}

          <div
            className="panel queue-panel"
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
              disabled={jogActive}
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

        </div>
      </div>
    </div>
  );
}
