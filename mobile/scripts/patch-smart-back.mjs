import fs from "fs";

const files = [
  ["src/pages/hr/AttendancePage.jsx", "/admin/more"],
  ["src/pages/hr/AttendanceDetailPage.jsx", "/admin/attendance"],
  ["src/pages/hr/LiveTrackingPage.jsx", "/admin/attendance"],
  ["src/pages/hr/PersonPage.jsx", "/admin"],
  ["src/pages/hr/PersonEditPage.jsx", "PERSON_EDIT"],
  ["src/pages/hr/PayrollPage.jsx", "/admin/more"],
  ["src/pages/hr/PayslipDetailPage.jsx", "/admin/payroll"],
  ["src/pages/hr/PoliciesPage.jsx", "/admin/more"],
  ["src/pages/hr/PolicyDetailPage.jsx", "/admin/policies"],
  ["src/pages/hr/ReportsPage.jsx", "/admin/more"],
  ["src/pages/hr/AssetsPage.jsx", "/admin/more"],
  ["src/pages/hr/OffersPage.jsx", "/admin/more"],
  ["src/pages/hr/SettingsPage.jsx", "/admin/more"],
];

for (const [file, fallback] of files) {
  let c = fs.readFileSync(file, "utf8");
  if (!c.includes("navigate(-1)")) {
    console.log("skip (no navigate(-1))", file);
    continue;
  }

  if (!c.includes('from "../../hooks/useSmartBack"')) {
    c = c.replace(
      /(from "react-router-dom";\r?\n)/,
      `$1import { useSmartBack } from "../../hooks/useSmartBack";\n`
    );
  }

  if (!c.includes("useSmartBack(")) {
    if (fallback === "PERSON_EDIT") {
      if (!c.includes("useParams")) {
        c = c.replace(
          /import \{([^}]+)\} from "react-router-dom";/,
          (m, inner) => {
            if (inner.includes("useParams")) return m;
            return `import {${inner}, useParams } from "react-router-dom";`.replace(
              ", ,",
              ","
            );
          }
        );
      }
      c = c.replace(
        /const navigate = useNavigate\(\);/,
        `const navigate = useNavigate();\n  const { id: personId } = useParams();\n  const goBack = useSmartBack(personId ? \`/admin/employees/\${personId}\` : "/admin");`
      );
    } else {
      c = c.replace(
        /const navigate = useNavigate\(\);/,
        `const navigate = useNavigate();\n  const goBack = useSmartBack("${fallback}");`
      );
    }
  }

  c = c.replace(/navigate\(-1\)/g, "goBack()");
  fs.writeFileSync(file, c);
  console.log("updated", file);
}
