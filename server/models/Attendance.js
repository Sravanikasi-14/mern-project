import mongoose from "mongoose";

export const ATTENDANCE_STATUSES = Object.freeze({
  PRESENT: "PRESENT",
  HALF_DAY: "HALF_DAY",
  ON_LEAVE: "ON_LEAVE",
  ABSENT: "ABSENT",
});

export const ATTENDANCE_SESSION_TYPES = Object.freeze({
  OFFICE: "OFFICE",
  REMOTE: "REMOTE",
});

export const ATTENDANCE_SESSION_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  INCOMPLETE: "INCOMPLETE",
});

const LocationSubSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    accuracy: {
      type: Number,
      min: 0,
      default: null,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const GeofenceResultSubSchema = new mongoose.Schema(
  {
    ok: { type: Boolean, default: true },
    distanceMeters: { type: Number, default: null },
    radiusMeters: { type: Number, default: null },
    reason: { type: String, default: "", trim: true },
    centerLatitude: { type: Number, default: null },
    centerLongitude: { type: Number, default: null },
    label: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const AttendanceSessionSubSchema = new mongoose.Schema(
  {
    sessionType: {
      type: String,
      enum: Object.values(ATTENDANCE_SESSION_TYPES),
      default: ATTENDANCE_SESSION_TYPES.OFFICE,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(ATTENDANCE_SESSION_STATUSES),
      default: ATTENDANCE_SESSION_STATUSES.ACTIVE,
      required: true,
    },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, default: null },
    checkInLocation: { type: LocationSubSchema, default: null },
    checkOutLocation: { type: LocationSubSchema, default: null },
    checkInGeofence: { type: GeofenceResultSubSchema, default: null },
    checkOutGeofence: { type: GeofenceResultSubSchema, default: null },
    remoteWorkRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemoteWorkRequest",
      default: null,
    },
    durationMinutes: { type: Number, default: 0 },
    outsideRadius: { type: Boolean, default: false },
    lastOutsideAt: { type: Date, default: null },
    lastInsideAt: { type: Date, default: null },
    notes: { type: String, default: "", trim: true },
  },
  { _id: true, timestamps: false }
);

export function createAttendanceSchema() {
  const attendanceSchema = new mongoose.Schema(
    {
      companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        index: true,
      },
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      date: {
        type: String, // YYYY-MM-DD in company timezone
        required: true,
        match: /^\d{4}-\d{2}-\d{2}$/,
        index: true,
      },
      status: {
        type: String,
        enum: Object.values(ATTENDANCE_STATUSES),
        default: ATTENDANCE_STATUSES.PRESENT,
        required: true,
        index: true,
      },
      /** Denormalized first check-in of the day (payroll/dashboard compatibility). */
      checkIn: {
        type: Date,
        default: null,
      },
      checkInLocation: {
        type: LocationSubSchema,
        default: null,
      },
      /** Denormalized last check-out of the day. */
      checkOut: {
        type: Date,
        default: null,
      },
      checkOutLocation: {
        type: LocationSubSchema,
        default: null,
      },
      workingHours: {
        type: String,
        default: "",
      },
      /** Sum of completed session durations (excludes breaks between sessions). */
      durationMinutes: {
        type: Number,
        default: 0,
      },
      sessions: {
        type: [AttendanceSessionSubSchema],
        default: [],
      },
      openSessionId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      notes: {
        type: String,
        default: "",
        trim: true,
      },
      regularization: {
        requestedAt: { type: Date, default: null },
        requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reason: { type: String, default: "", trim: true },
        decidedAt: { type: Date, default: null },
        decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        decision: { type: String, enum: ["", "APPROVED", "REJECTED"], default: "" },
        remarks: { type: String, default: "", trim: true },
        /** Append-only trail; originals preserved — never a silent remote-approval bypass. */
        auditTrail: {
          type: [
            {
              at: { type: Date, default: Date.now },
              by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
              action: { type: String, default: "", trim: true },
              reason: { type: String, default: "", trim: true },
              original: { type: mongoose.Schema.Types.Mixed, default: null },
            },
          ],
          default: [],
        },
      },
      schemaVersion: {
        type: Number,
        default: 2,
      },
    },
    {
      timestamps: true,
      collection: "attendances",
    }
  );

  // Guarantee single record per employee per business date
  attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
  attendanceSchema.index({ date: 1, status: 1 });
  attendanceSchema.index({ date: 1, employeeId: 1 });
  attendanceSchema.index({ employeeId: 1, createdAt: -1 });
  attendanceSchema.index({ openSessionId: 1 }, { sparse: true });

  return attendanceSchema;
}

export function getAttendanceModel(connection) {
  return (
    connection.models.Attendance ||
    connection.model("Attendance", createAttendanceSchema())
  );
}

/** Normalize legacy single-pair rows into a sessions view for readers. */
export function attendanceSessionsView(attendance) {
  if (!attendance) return [];
  if (Array.isArray(attendance.sessions) && attendance.sessions.length > 0) {
    return attendance.sessions;
  }
  if (!attendance.checkIn) return [];
  return [
    {
      _id: attendance._id,
      sessionType: ATTENDANCE_SESSION_TYPES.OFFICE,
      status: attendance.checkOut
        ? ATTENDANCE_SESSION_STATUSES.COMPLETED
        : ATTENDANCE_SESSION_STATUSES.ACTIVE,
      checkIn: attendance.checkIn,
      checkOut: attendance.checkOut || null,
      checkInLocation: attendance.checkInLocation || null,
      checkOutLocation: attendance.checkOutLocation || null,
      durationMinutes: attendance.durationMinutes || 0,
    },
  ];
}
