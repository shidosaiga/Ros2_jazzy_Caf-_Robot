// CafeRobotApp.jsx
// ติดตั้ง: npm install roslib
// รัน: npm start
// แล้วเปิด http://localhost:3000

import { useState, useEffect, useRef, useCallback } from "react";
import * as ROSLIB from "roslib";

// ========== ตำแหน่งโต๊ะเริ่มต้นใน map (แก้ให้ตรงกับ map จริง หรือเพิ่ม/ลบผ่าน UI ได้) ==========
const DEFAULT_TABLE_POSITIONS = {
  1: { x: 1.0, y: 2.0, label: "โต๊ะ 1" },
  2: { x: 2.5, y: 2.0, label: "โต๊ะ 2" },
  3: { x: 4.0, y: 2.0, label: "โต๊ะ 3" },
  4: { x: 1.0, y: 0.5, label: "โต๊ะ 4" },
  5: { x: 2.5, y: 0.5, label: "โต๊ะ 5" },
  6: { x: 4.0, y: 0.5, label: "โต๊ะ 6" },
};

const HOME = { x: 0.0, y: 0.0, label: "Home" };

// ========== STYLES ==========
const S = {
  app: { minHeight: "100vh", background: "#0f1117", color: "#e8e6e0", fontFamily: "'Inter', sans-serif", padding: "1.5rem" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" },
  title: { fontSize: "20px", fontWeight: "600", color: "#e8e6e0" },
  connRow: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "1.25rem" },
  input: { flex: 1, background: "#1a1d27", border: "1px solid #2d3148", borderRadius: "8px", padding: "8px 12px", color: "#e8e6e0", fontSize: "13px", outline: "none" },
  btn: (color = "#2563eb") => ({ background: color, border: "none", borderRadius: "8px", padding: "8px 16px", color: "#fff", fontSize: "13px", fontWeight: "500", cursor: "pointer" }),
  dot: (on) => ({ width: 9, height: 9, borderRadius: "50%", background: on ? "#22c55e" : "#ef4444", display: "inline-block" }),
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" },
  card: { background: "#1a1d27", borderRadius: "12px", border: "1px solid #2d3148", padding: "1rem" },
  sectionLabel: { fontSize: "12px", color: "#6b7280", marginBottom: "0.75rem", fontWeight: "500", textTransform: "uppercase", letterSpacing: "0.05em" },
  tableGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" },
  tableBtn: (state) => ({
    aspectRatio: "1", borderRadius: "50%", border: `2px solid ${state === "active" ? "#2563eb" : state === "queued" ? "#f59e0b" : state === "done" ? "#22c55e" : "#2d3148"}`,
    background: state === "active" ? "#1e3a5f" : state === "queued" ? "#3d2c05" : state === "done" ? "#052e16" : "#252836",
    cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px",
    transition: "all .15s",
  }),
  tableBtnNum: (state) => ({ fontSize: "22px", fontWeight: "600", color: state === "active" ? "#60a5fa" : state === "queued" ? "#fbbf24" : state === "done" ? "#4ade80" : "#e8e6e0" }),
  tableBtnLabel: { fontSize: "11px", color: "#6b7280" },
  queueItem: (i) => ({ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: i === 0 ? "#1e3a5f" : "#1a1d27", borderRadius: "8px", marginBottom: "6px", border: `1px solid ${i === 0 ? "#2563eb" : "#2d3148"}` }),
  mapCanvas: { width: "100%", height: "200px", background: "#111318", borderRadius: "8px", position: "relative", overflow: "hidden" },
  robotDot: (px, py) => ({ position: "absolute", width: 14, height: 14, borderRadius: "50%", background: "#2563eb", border: "2px solid #fff", left: px - 7, top: py - 7, transition: "all .5s", zIndex: 10 }),
  goalDot: (px, py) => ({ position: "absolute", width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", border: "2px solid #fff", left: px - 5, top: py - 5 }),
  statusBadge: (status) => ({ display: "inline-block", padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "500", background: status === "moving" ? "#1e3a5f" : status === "idle" ? "#052e16" : "#252836", color: status === "moving" ? "#60a5fa" : status === "idle" ? "#4ade80" : "#9ca3af" }),
  homeBtn: { width: "100%", padding: "12px", background: "#1a1d27", border: "1px solid #2d3148", borderRadius: "10px", color: "#e8e6e0", fontSize: "14px", fontWeight: "500", cursor: "pointer", marginTop: "10px" },
  logBox: { background: "#0d0f18", borderRadius: "8px", padding: "8px 12px", fontFamily: "monospace", fontSize: "11px", color: "#6b7280", maxHeight: "80px", overflowY: "auto" },
  camBox: { width: "100%", height: "160px", background: "#0d0f18", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" },
  detBox: { position: "absolute", top: "6px", left: "6px", right: "6px", display: "flex", flexWrap: "wrap", gap: "4px" },
  detTag: { background: "rgba(37,99,235,.8)", color: "#fff", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" },
  tableTag: { fontSize: 11, background: "#252836", padding: "3px 8px", borderRadius: 12, display: "flex", alignItems: "center", gap: 6 },
  tableTagRemove: { cursor: "pointer", color: "#ef4444", fontWeight: "600" },
};

// ========== MAP RENDERER ==========
function MapCanvas({ mapData, robotPose, goalPose, tablePositions }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !mapData) return;
    const ctx = c.getContext("2d");
    const { width, height, data } = mapData;
    const cw = c.width, ch = c.height;
    const scaleX = cw / width, scaleY = ch / height;
    ctx.clearRect(0, 0, cw, ch);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = data[y * width + x];
        ctx.fillStyle = val === -1 ? "#252836" : val === 0 ? "#e8e6e0" : "#111318";
        ctx.fillRect(x * scaleX, y * scaleY, scaleX + 1, scaleY + 1);
      }
    }
  }, [mapData]);

  const toPixel = useCallback((wx, wy) => {
    if (!mapData || !canvasRef.current) return { px: 0, py: 0 };
    const { resolution, origin } = mapData;
    const c = canvasRef.current;
    const scaleX = c.width / mapData.width;
    const scaleY = c.height / mapData.height;
    return {
      px: ((wx - origin.x) / resolution) * scaleX,
      py: c.height - ((wy - origin.y) / resolution) * scaleY,
    };
  }, [mapData]);

  const robotPx = robotPose ? toPixel(robotPose.x, robotPose.y) : null;
  const goalPx = goalPose ? toPixel(goalPose.x, goalPose.y) : null;

  return (
    <div style={S.mapCanvas}>
      <canvas ref={canvasRef} width={400} height={200} style={{ width: "100%", height: "100%" }} />
      {Object.entries(tablePositions).map(([id, t]) => {
        const { px, py } = toPixel(t.x, t.y);
        return (
          <div
            key={id}
            style={{
              position: "absolute", left: px - 8, top: py - 8, width: 16, height: 16, borderRadius: "50%",
              background: "#374151", border: "1px solid #6b7280", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 8, color: "#9ca3af",
            }}
          >
            {id}
          </div>
        );
      })}
      {goalPx && <div style={S.goalDot(goalPx.px, goalPx.py)} />}
      {robotPx && <div style={S.robotDot(robotPx.px, robotPx.py)} />}
    </div>
  );
}

// ========== MAIN APP ==========
export default function App() {
  const [ip, setIp] = useState("172.20.10.2:9090");
  const [connected, setConnected] = useState(false);
  const [robotStatus, setRobotStatus] = useState("idle");
  const [queue, setQueue] = useState([]); // [{order:1, tableId:2}, ...]
  const [currentGoal, setCurrentGoal] = useState(null);
  const [tableStates, setTableStates] = useState({}); // {1: 'queued'|'active'|'done'|''}
  const [tablePositions, setTablePositions] = useState(DEFAULT_TABLE_POSITIONS);
  const [newTableX, setNewTableX] = useState("");
  const [newTableY, setNewTableY] = useState("");
  const [mapData, setMapData] = useState(null);
  const [robotPose, setRobotPose] = useState(null);
  const [detections, setDetections] = useState([]);
  const [logs, setLogs] = useState(["รอการเชื่อมต่อ..."]);
  const [orderCount, setOrderCount] = useState(0);
  const rosRef = useRef(null);
  const goalPubRef = useRef(null);

  const addLog = (msg) => setLogs(p => [`${new Date().toLocaleTimeString("th")} ${msg}`, ...p.slice(0, 15)]);

  // ========== CONNECT ==========
  const connect = () => {
    if (rosRef.current) rosRef.current.close();
    const ros = new ROSLIB.Ros({ url: `ws://${ip}` });
    rosRef.current = ros;
    ros.on("connection", () => {
      setConnected(true);
      addLog("เชื่อมต่อสำเร็จ");
      // Goal publisher
      goalPubRef.current = new ROSLIB.Topic({ ros, name: "/move_base_simple/goal", messageType: "geometry_msgs/PoseStamped" });
      // Subscribe /map
      const mapSub = new ROSLIB.Topic({ ros, name: "/map", messageType: "nav_msgs/OccupancyGrid" });
      mapSub.subscribe((msg) => {
        setMapData({
          width: msg.info.width,
          height: msg.info.height,
          data: msg.data,
          resolution: msg.info.resolution,
          origin: { x: msg.info.origin.position.x, y: msg.info.origin.position.y },
        });
      });
      // Subscribe /odom for robot position
      const odomSub = new ROSLIB.Topic({ ros, name: "/odom", messageType: "nav_msgs/Odometry" });
      odomSub.subscribe((msg) => {
        setRobotPose({ x: msg.pose.pose.position.x, y: msg.pose.pose.position.y });
      });
      // Subscribe detections
      const detSub = new ROSLIB.Topic({ ros, name: "/camera/detections", messageType: "vision_msgs/Detection2DArray" });
      detSub.subscribe((msg) => {
        const dets = (msg.detections || []).map(d => ({ id: d.id, score: d.results?.[0]?.hypothesis?.score?.toFixed(2) }));
        setDetections(dets);
      });
    });
    ros.on("error", () => addLog("เกิดข้อผิดพลาด"));
    ros.on("close", () => { setConnected(false); addLog("ตัดการเชื่อมต่อ"); });
  };

  // ========== SEND GOAL ==========
  const sendGoalToROS = useCallback((pos) => {
    if (!goalPubRef.current) return;
    goalPubRef.current.publish({
      header: { frame_id: "map" },
      pose: { position: { x: pos.x, y: pos.y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    });
  }, []);

  // ========== ADD TO QUEUE ==========
  const addTable = (tableId) => {
    if (tableStates[tableId] === "queued" || tableStates[tableId] === "active") return;
    const newOrder = orderCount + 1;
    setOrderCount(newOrder);
    setQueue(prev => {
      const newQueue = [...prev, { order: newOrder, tableId }];
      // ถ้าไม่มี active goal ให้ส่งทันที
      if (prev.length === 0) {
        const pos = tablePositions[tableId];
        sendGoalToROS(pos);
        setCurrentGoal({ tableId, ...pos });
        setRobotStatus("moving");
        setTableStates(s => ({ ...s, [tableId]: "active" }));
        addLog(`Order ${newOrder}: ส่งไปโต๊ะ ${tableId}`);
        return []; // ส่งแล้ว ไม่ต้อง queue
      }
      setTableStates(s => ({ ...s, [tableId]: "queued" }));
      addLog(`Order ${newOrder}: เพิ่มโต๊ะ ${tableId} เข้า queue`);
      return newQueue;
    });
  };

  // ========== ARRIVED (simulate) ==========
  const markArrived = () => {
    if (!currentGoal) return;
    const doneId = currentGoal.tableId;
    setTableStates(s => ({ ...s, [doneId]: "done" }));
    setCurrentGoal(null);
    addLog(`ถึงโต๊ะ ${doneId} แล้ว ✓`);
    // ไปคิวถัดไป
    setQueue(prev => {
      if (prev.length === 0) {
        setRobotStatus("idle");
        return [];
      }
      const next = prev[0];
      const rest = prev.slice(1);
      const pos = tablePositions[next.tableId];
      sendGoalToROS(pos);
      setCurrentGoal({ tableId: next.tableId, ...pos });
      setRobotStatus("moving");
      setTableStates(s => ({ ...s, [next.tableId]: "active" }));
      addLog(`ส่งไปโต๊ะ ${next.tableId} (คิวถัดไป)`);
      return rest;
    });
    // clear done หลัง 3 วิ
    setTimeout(() => setTableStates(s => ({ ...s, [doneId]: "" })), 3000);
  };

  // ========== GO HOME ==========
  const goHome = () => {
    setQueue([]);
    setTableStates({});
    setCurrentGoal(null);
    sendGoalToROS(HOME);
    setRobotStatus("moving");
    addLog("กลับ Home");
    setTimeout(() => setRobotStatus("idle"), 3000);
  };

  // ========== เพิ่มโต๊ะใหม่ ==========
  const addNewTable = () => {
    const x = parseFloat(newTableX);
    const y = parseFloat(newTableY);
    if (isNaN(x) || isNaN(y)) {
      addLog("กรุณาใส่พิกัด x, y ให้ถูกต้อง");
      return;
    }
    const existingIds = Object.keys(tablePositions).map(Number);
    const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    setTablePositions(prev => ({
      ...prev,
      [nextId]: { x, y, label: `โต๊ะ ${nextId}` },
    }));
    addLog(`เพิ่มโต๊ะ ${nextId} ที่ (${x}, ${y})`);
    setNewTableX("");
    setNewTableY("");
  };

  // ========== ลบโต๊ะ ==========
  const removeTable = (tableId) => {
    setTablePositions(prev => {
      const updated = { ...prev };
      delete updated[tableId];
      return updated;
    });
    setTableStates(s => {
      const updated = { ...s };
      delete updated[tableId];
      return updated;
    });
    addLog(`ลบโต๊ะ ${tableId}`);
  };

  return (
    <div style={S.app}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.title}>🤖 Café Robot Control</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280" }}>
          <span style={S.dot(connected)} />
          {connected ? "เชื่อมต่อแล้ว" : "ไม่ได้เชื่อมต่อ"}
        </span>
      </div>

      {/* Connection */}
      <div style={S.connRow}>
        <input style={S.input} value={ip} onChange={e => setIp(e.target.value)} placeholder="172.20.10.2:9090" />
        <button style={S.btn(connected ? "#374151" : "#2563eb")} onClick={connected ? () => rosRef.current?.close() : connect}>
          {connected ? "ตัดการเชื่อมต่อ" : "เชื่อมต่อ"}
        </button>
      </div>

      <div style={S.grid}>
        {/* LEFT: Map + Status */}
        <div>
          {/* Status */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={S.sectionLabel}>สถานะหุ่นยนต์</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 500 }}>
                {currentGoal ? `กำลังไปโต๊ะ ${currentGoal.tableId}` : "รอคำสั่ง"}
              </span>
              <span style={S.statusBadge(robotStatus)}>
                {robotStatus === "moving" ? "กำลังเดิน" : "หยุด"}
              </span>
            </div>
            {queue.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                คิวถัดไป: {queue.map(q => `โต๊ะ ${q.tableId}`).join(" → ")}
              </div>
            )}
          </div>

          {/* Map */}
          <div style={S.card}>
            <div style={S.sectionLabel}>แผนที่ realtime</div>
            <MapCanvas mapData={mapData} robotPose={robotPose} goalPose={currentGoal} tablePositions={tablePositions} />
            <div style={{ fontSize: 11, color: "#374151", marginTop: 6, display: "flex", gap: 12 }}>
              <span>🔵 หุ่นยนต์</span>
              <span>🟡 เป้าหมาย</span>
              <span>⚫ ผนัง</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Tables + Add table + Queue + Camera */}
        <div>
          {/* Tables */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={S.sectionLabel}>เลือกโต๊ะ</div>
            <div style={S.tableGrid}>
              {Object.entries(tablePositions).map(([id, pos]) => {
                const state = tableStates[parseInt(id)] || "";
                return (
                  <button key={id} style={S.tableBtn(state)} onClick={() => addTable(parseInt(id))}>
                    <span style={S.tableBtnNum(state)}>{id}</span>
                    <span style={S.tableBtnLabel}>
                      {state === "active" ? "กำลังไป" : state === "queued" ? "รอคิว" : state === "done" ? "ส่งแล้ว" : "ว่าง"}
                    </span>
                  </button>
                );
              })}
              {Object.keys(tablePositions).length === 0 && (
                <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#4b5563", textAlign: "center", padding: "8px" }}>
                  ยังไม่มีโต๊ะ เพิ่มด้านล่างได้เลย
                </div>
              )}
            </div>
          </div>

          {/* เพิ่มโต๊ะ */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={S.sectionLabel}>เพิ่มโต๊ะใหม่</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                style={S.input}
                placeholder="x"
                type="number"
                step="0.1"
                value={newTableX}
                onChange={e => setNewTableX(e.target.value)}
              />
              <input
                style={S.input}
                placeholder="y"
                type="number"
                step="0.1"
                value={newTableY}
                onChange={e => setNewTableY(e.target.value)}
              />
              <button style={S.btn("#2563eb")} onClick={addNewTable}>+ เพิ่ม</button>
            </div>
            <div style={{ fontSize: 11, color: "#4b5563" }}>
              วิธีหาพิกัด: เปิด Foxglove คลิกจุดบน map แล้วดู x, y จาก panel
            </div>
            {Object.keys(tablePositions).length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(tablePositions).map(([id, pos]) => (
                  <span key={id} style={S.tableTag}>
                    โต๊ะ {id} ({pos.x}, {pos.y})
                    <span onClick={() => removeTable(id)} style={S.tableTagRemove}>✕</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Queue */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={S.sectionLabel}>Queue</div>
            {currentGoal && (
              <div style={S.queueItem(0)}>
                <span style={{ fontSize: 13 }}>🚀 กำลังไป <b>โต๊ะ {currentGoal.tableId}</b></span>
                <button style={S.btn("#22c55e")} onClick={markArrived}>ถึงแล้ว ✓</button>
              </div>
            )}
            {queue.map((q, i) => (
              <div key={q.order} style={S.queueItem(i + 1)}>
                <span style={{ fontSize: 13 }}>⏳ Order {q.order}: โต๊ะ {q.tableId}</span>
                <button style={S.btn("#374151")} onClick={() => {
                  setQueue(p => p.filter((_, idx) => idx !== i));
                  setTableStates(s => ({ ...s, [q.tableId]: "" }));
                }}>ยกเลิก</button>
              </div>
            ))}
            {!currentGoal && queue.length === 0 && (
              <div style={{ fontSize: 12, color: "#4b5563", textAlign: "center", padding: "8px" }}>ไม่มี order ในคิว</div>
            )}
            <button style={S.homeBtn} onClick={goHome}>🏠 กลับ Home / ยกเลิกทั้งหมด</button>
          </div>

          {/* Camera */}
          <div style={S.card}>
            <div style={S.sectionLabel}>กล้อง Pi AI (detections)</div>
            <div style={S.camBox}>
              {detections.length === 0 ? (
                <span style={{ fontSize: 12, color: "#374151" }}>รอ detection...</span>
              ) : (
                <div style={S.detBox}>
                  {detections.map((d, i) => (
                    <span key={i} style={S.detTag}>{d.id} {d.score}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log */}
      <div style={S.card}>
        <div style={S.sectionLabel}>Log</div>
        <div style={S.logBox}>
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}
