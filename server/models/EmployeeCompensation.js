import mongoose from "mongoose";

export function createEmployeeCompensationSchema() {
  const compensationSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        unique: true,
      },
      revisions: {
        type: [
          {
            effectiveFromDate: { type: Date, required: true },
            monthlyCostToCompany: { type: mongoose.Schema.Types.Decimal128, required: true },
            salaryComponents: {
              basicSalary: { type: mongoose.Schema.Types.Decimal128, default: 0 },
              houseRentAllowance: { type: mongoose.Schema.Types.Decimal128, default: 0 },
              conveyanceAllowance: { type: mongoose.Schema.Types.Decimal128, default: 0 },
              specialAllowance: { type: mongoose.Schema.Types.Decimal128, default: 0 },
              employerProvidentFund: { type: mongoose.Schema.Types.Decimal128, default: 0 },
              otherDeductions: { type: mongoose.Schema.Types.Decimal128, default: 0 },
            },
            revisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            revisedAt: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "employee_compensation",
    }
  );

  return compensationSchema;
}

export function getEmployeeCompensationModel(connection) {
  return (
    connection.models.EmployeeCompensation ||
    connection.model("EmployeeCompensation", createEmployeeCompensationSchema())
  );
}
