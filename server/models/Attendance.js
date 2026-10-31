import mongoose from "mongoose";

export const ATTENDANCE_STATUSES = Object.freeze({
  PRESENT: "PRESENT",
  HALF_DAY: "HALF_DAY",
  ON_LEAVE: "ON_LEAVE",
  ABSENT: "ABSENT",
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
      checkIn: {
        type: Date,
        default: null,
      },
      checkInLocation: {
        type: LocationSubSchema,
        default: null,
      },
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
      durationMinutes: {
        type: Number,
        default: 0,
      },
      notes: {
        type: String,
        default: "",
        trim: true,
      },
      schemaVersion: {
        type: Number,
        default: 1,
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

  return attendanceSchema;
}

export function getAttendanceModel(connection) {
  return (
    connection.models.Attendance ||
    connection.model("Attendance", createAttendanceSchema())
  );
}
